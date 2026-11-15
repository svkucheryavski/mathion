import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionSettingsModal from '../components/editor/VersionSettingsModal.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import type { AdminTreeVersion } from '../lib/types';
import { PageAsk, PAGE_ASK_KEY } from '../lib/askInPlace.svelte';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: 'x', json: () => Promise.resolve(body),
    text: () => Promise.resolve(''), headers: new Headers({ 'content-type': 'application/json' }) } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return { id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: 'Hello', info_html: '<p>Hello</p>',
    max_quiz_attempts: 3, label: 'Draft', created_at: '', published_at: null, archived_at: null, content_updated_at: '', ...over };
}
let target: HTMLDivElement; let cmp: ReturnType<typeof mount> | null = null; let registry: DirtyRegistry;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((u: string, i?: RequestInit) => (String(u).endsWith('/admin-tree')
    ? jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] })
    : i?.method === 'PATCH' ? jres(mkVersion()) : jres({})));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); (globalThis as { fetch: typeof fetch }).fetch = originalFetch; clearToasts(); document.documentElement.style.overflow = ''; vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div'); document.body.appendChild(target);
  registry = createDirtyRegistry();
  const props = { vid: 1, version: mkVersion(), editable: true, stillOnVid: () => true, onClose: vi.fn(), ...over };
  cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
  flushSync();
  return props;
}
const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const input = (l: string) => panel().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${l}"]`)!;
const footBtn = (t: string) => [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === t);
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
const patches = () => fetchSpy.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([u, i]) => [String(u), JSON.parse(String(i!.body))]);
const reloads = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/admin-tree')).length;

describe('VersionSettingsModal (Slice-5c T5, D12)', () => {
  it('editable: Label, Info, Max quiz attempts seeded from the version; Save disabled while clean', () => {
    render();
    expect(panel().querySelector('h2')!.textContent).toBe('Version settings');
    expect(input('Label').value).toBe('Draft');
    expect(input('Info (markdown)').value).toBe('Hello');
    expect(input('Max quiz attempts').value).toBe('3');
    expect(footBtn('Save')!.disabled).toBe(true);
  });
  it('settings PATCH carries only changed fields, then reloads, toasts and closes', async () => {
    const p = render();
    type(input('Max quiz attempts'), '5');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([['/api/versions/1', { max_quiz_attempts: 5 }]]);
    expect(reloads()).toBe(1);
    expect(toasts.list.map((t) => t.message)).toContain('Saved');
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  // Ported from VersionMetaForm.label (deleted): a label edit sends {label} only.
  it('a Label edit PATCHes {label} only', async () => {
    render();
    type(input('Label'), 'New Label');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([['/api/versions/1', { label: 'New Label' }]]);
  });
  it('several edits go in ONE PATCH', async () => {
    render();
    type(input('Label'), 'L2');
    type(input('Info (markdown)'), 'More');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([['/api/versions/1', { label: 'L2', info_md: 'More' }]]);
  });
  // Ported from VersionMetaForm.label: out of range is rejected on the field, then a valid number is sent as a number.
  it('attempts outside 1–10 block Save with the field error; a valid value then saves as a number', async () => {
    render();
    type(input('Max quiz attempts'), '11');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([]);
    const att = input('Max quiz attempts');
    expect(att.getAttribute('aria-invalid')).toBe('true');
    const err = document.getElementById(att.getAttribute('aria-describedby')!)!;
    expect(err.textContent).toBe('Max quiz attempts must be a whole number between 1 and 10');
    expect(panel().querySelector('[role="alert"]')).toBeNull();
    type(att, '4');
    expect(att.getAttribute('aria-invalid')).toBeNull();
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([['/api/versions/1', { max_quiz_attempts: 4 }]]);
  });
  // The label is mandatory (user, 2026-10-08): it can't be cleared.
  it('an empty Label shows "Label is required" on the field and sends nothing', async () => {
    render();
    type(input('Label'), '   ');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([]);
    const lab = input('Label');
    expect(lab.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(lab.getAttribute('aria-describedby')!)!.textContent).toBe('Label is required');
    type(lab, 'L2');
    expect(lab.getAttribute('aria-invalid')).toBeNull();
    footBtn('Save')!.click(); await settle();
    expect(patches()).toEqual([['/api/versions/1', { label: 'L2' }]]);
  });
  it('a failed PATCH keeps the modal open with the message', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? jres({ detail: 'Nope' }, 409) : jres({})));
    const p = render();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(panel().querySelector('[role="alert"]')!.textContent).toContain('Nope');
    expect(footBtn('Save')!.disabled).toBe(false);
  });
  // F4 (C7 point 1): Save stays focusable while busy, so a failure leaves focus on it.
  it('a failed Save keeps focus on Save', async () => {
    let release!: () => void;
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({ detail: 'Nope' }, 409))
      : jres({})));
    render();
    await settle();   // the open's autofocus lands first
    type(input('Label'), 'L2');
    const save = footBtn('Save')!;
    save.focus();
    save.click(); await settle();
    expect(save.disabled).toBe(false);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(save);
    release(); await settle();
    expect(footBtn('Save')).toBe(save);
    expect(document.activeElement).toBe(save);
  });
  it('a failed Save repairs a focus the browser dropped during the request (review r1)', async () => {
    let release!: () => void;
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH'
      ? new Promise<void>((r) => { release = r; }).then(() => jres({ detail: 'Nope' }, 409))
      : jres({})));
    render();
    await settle();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    const stand = document.createElement('button');
    panel().append(stand); stand.focus(); stand.remove();
    release(); await settle();
    expect(document.activeElement).toBe(footBtn('Save'));
  });
  it('a save that lands after a version switch does not reload the other version', async () => {
    const p = render({ stillOnVid: () => false });
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(patches()).toHaveLength(1);
    expect(reloads()).toBe(0);
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  // Review r1 (both lanes): the Save button lives in the modal footer, so nothing
  // submits on Enter by itself; the old card saved on Enter.
  const enter = (el: Element) => { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); el.dispatchEvent(e); return e; };
  it('Enter in Label or Max quiz attempts saves (one PATCH); Enter in Info is a newline', async () => {
    render();
    type(input('Info (markdown)'), 'More');
    const ev = enter(input('Info (markdown)'));
    expect(ev.defaultPrevented).toBe(false);
    await settle();
    expect(patches()).toEqual([]);
    type(input('Label'), 'L2');
    enter(input('Label')); enter(input('Label'));
    await settle();
    expect(patches()).toEqual([['/api/versions/1', { label: 'L2', info_md: 'More' }]]);
  });
  it('Safari\'s IME-commit Enter (keyCode 229) in Label does not save (VR-B)', async () => {
    render();
    type(input('Label'), 'L2');
    input('Label').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: false, bubbles: true, cancelable: true }));
    await settle();
    expect(patches()).toEqual([]);
  });
  it('Enter in an out-of-range attempts field shows the error and sends nothing', async () => {
    render();
    type(input('Max quiz attempts'), '0');
    enter(input('Max quiz attempts')); await settle();
    expect(patches()).toEqual([]);
    expect(input('Max quiz attempts').getAttribute('aria-invalid')).toBe('true');
  });
  it('Discard resets the fields', () => {
    render();
    type(input('Label'), 'L2');
    footBtn('Discard')!.click(); flushSync();
    expect(input('Label').value).toBe('Draft');
    expect(footBtn('Save')!.disabled).toBe(true);
  });
  it('close with changes asks in place of the footer buttons (#10); Cancel → ×; discardAll (Back) closes', async () => {
    const p = render();
    await settle();   // the mount's autofocus lands first, as it does on screen
    type(input('Label'), 'L2');
    expect(registry.isAnyDirty()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    const row = panel().querySelector('footer.modal-foot .inline-confirm')!;
    expect(row.querySelector('.warning')!.textContent!.trim()).toBe('Discard unsaved changes?');
    expect(row.querySelector('button.confirm')!.textContent!.trim()).toBe('Discard');
    expect(footBtn('Save')).toBeUndefined();
    expect(panel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(row.querySelector('button.cancel'));
    (row.querySelector('button.cancel') as HTMLButtonElement).click();
    await settle();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(input('Label').value).toBe('L2');
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
    registry.discardAll();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('Discard on the close question closes', async () => {
    const p = render();
    type(input('Label'), 'L2');
    panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.click();
    flushSync();
    panel().querySelector<HTMLButtonElement>('footer.modal-foot .inline-confirm button.confirm')!.click();
    await settle();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('close with nothing changed closes at once', () => {
    const p = render();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel().querySelector('.inline-confirm')).toBeNull();
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
  it('read-only (published / archived / disabled): values as text, no footer, no inputs', () => {
    render({ editable: false, version: mkVersion({ state: 'published' }) });
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    expect(panel().querySelector('input, textarea')).toBeNull();
    expect(panel().textContent).toContain('Draft');
    expect(panel().textContent).toContain('Hello');
    expect(panel().textContent).toContain('3');
    expect(registry.isAnyDirty()).toBe(false);
  });
  it('read-only: empty Label and Info read "Not set"', () => {
    render({ editable: false, version: mkVersion({ label: '', info_md: '' }) });
    expect([...panel().querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['Not set', 'Not set', '3']);
    // Muted, as the old card's placeholder, so it doesn't read as a real value.
    expect([...panel().querySelectorAll('dd .not-set')].map((x) => x.textContent)).toEqual(['Not set', 'Not set']);
  });
});

describe('VersionSettingsModal — backlog round (VR-B)', () => {
  it('the leave guard does not ask while a Save runs', async () => {
    let release!: () => void;
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH'
      ? new Promise<void>((r) => { release = r; }).then(() => jres(mkVersion()))
      : jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] })));
    render();
    type(input('Label'), 'L2');
    expect(registry.isAnyDirty()).toBe(true);
    footBtn('Save')!.click(); await settle();
    expect(registry.isAnyDirty()).toBe(false);
    release(); await settle();
  });
  for (const status of [403, 409]) {
    it(`a Save ${status} reloads the tree and shows the message`, async () => {
      fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH'
        ? jres({ detail: 'Only a created version can change its info' }, status)
        : jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion({ state: 'published' }), blocks: [] })));
      render();
      type(input('Label'), 'L2');
      footBtn('Save')!.click(); await settle();
      expect(reloads()).toBe(1);
      expect(panel().querySelector('[role="alert"]')!.textContent).toBe('Only a created version can change its info');
    });
  }
  it('a refused Save keeps its message once the modal turns read-only', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? jres({ detail: 'No' }, 409) : jres({})));
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => false, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
    flushSync(); await settle();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    expect(panel().querySelector('dl.ro')).not.toBeNull();
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('No');
  });
  it('an offline Save error does not follow the modal into read-only (whole-branch review)', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? Promise.reject(new TypeError('Failed to fetch')) : jres({})));
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => true, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
    flushSync(); await settle();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Could not reach server. Check your connection.');
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    expect(panel().querySelector('dl.ro')).not.toBeNull();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
  });
  it('a 409 Save then an offline Save: the flip to read-only clears the offline error (fix-pass review)', async () => {
    let n = 0;
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => {
      if (i?.method !== 'PATCH') return jres({});
      n += 1;
      return n === 1 ? jres({ detail: 'Changed' }, 409) : Promise.reject(new TypeError('Failed to fetch'));
    });
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => false, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
    flushSync(); await settle();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Changed');
    footBtn('Save')!.click(); await settle();
    expect(panel().querySelector('[role="alert"]')?.textContent).toBe('Could not reach server. Check your connection.');
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    expect(panel().querySelector('dl.ro')).not.toBeNull();
    expect(panel().querySelector('[role="alert"]')).toBeNull();
  });
  it('a Save 422 does not reload', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? jres({ detail: 'Bad' }, 422) : jres({})));
    render();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(reloads()).toBe(0);
  });
  it('a Save 403 after a version change does not reload', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? jres({ detail: 'No' }, 403) : jres({})));
    render({ stillOnVid: () => false });
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(reloads()).toBe(0);
  });
  it('an offline Save says OFFLINE_MESSAGE', async () => {
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH' ? Promise.reject(new TypeError('Failed to fetch')) : jres({})));
    render();
    type(input('Label'), 'L2');
    footBtn('Save')!.click(); await settle();
    expect(panel().querySelector('[role="alert"]')!.textContent).toBe('Could not reach server. Check your connection.');
  });
  it('a read-only modal shows the reason', () => {
    render({ editable: false, version: mkVersion({ state: 'published' }) });
    expect(panel().querySelector('.reason')!.textContent).toBe('Only a created version can change its info');
  });
  it('an editable modal shows no reason', () => {
    render();
    expect(panel().querySelector('.reason')).toBeNull();
  });
  it('a blank label and bad attempts show both errors on one Save', async () => {
    render();
    type(input('Label'), '');
    type(input('Max quiz attempts'), '0');
    footBtn('Save')!.click(); await settle();
    expect(panel().querySelectorAll('small.field-err').length).toBe(2);
    expect(input('Label').getAttribute('aria-invalid')).toBe('true');
    expect(input('Max quiz attempts').getAttribute('aria-invalid')).toBe('true');
    expect(patches()).toEqual([]);
  });
  for (const [name, fail, msg] of [
    ['a 403 with its reason', () => jres({ detail: 'Only a created version can change its info' }, 403), 'Only a created version can change its info'],
    ['an offline Save', () => Promise.reject(new TypeError('Failed to fetch')), 'Could not reach server. Check your connection.'],
  ] as const) {
    it(`${name} that fails after the modal closed toasts its message`, async () => {
      let reject!: () => void;
      fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH'
        ? new Promise<void>((r) => { reject = r; }).then(fail)
        : jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] })));
      render();
      type(input('Label'), 'L2');
      footBtn('Save')!.click(); await settle();
      unmount(cmp!); cmp = null;
      reject(); await settle();
      expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([[msg, 'error']]);
    });
  }
  it('a flip to read-only gives a lost focus to the modal\'s ×', async () => {
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => true, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
    flushSync(); await settle();                     // the mount's autofocus has run
    expect(footBtn('Discard')).toBeDefined();
    input('Label').focus();
    input('Label').blur();                          // a browser drops focus to <body> when the form goes
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
  });
  it('a flip to read-only under the modal\'s own question withdraws it, so × closes', async () => {
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => true, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
    flushSync(); await settle();
    type(input('Label'), 'L2');
    const close = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
    close().click(); await settle();
    expect(panel().querySelector('.inline-confirm')).not.toBeNull();
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    close().click(); await settle();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it('a Save that fails after a flip to read-only gives focus to ×', async () => {
    let reject!: () => void;
    fetchSpy.mockImplementation((_u: string, i?: RequestInit) => (i?.method === 'PATCH'
      ? new Promise<void>((r) => { reject = r; }).then(() => jres({ detail: 'No' }, 409))
      : jres({})));
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => false, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
    flushSync(); await settle();
    type(input('Label'), 'L2');
    footBtn('Save')!.focus();
    footBtn('Save')!.click(); await settle();
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    // A browser drops focus to <body> with the footer (jsdom keeps it on the removed button).
    const tmp = document.createElement('input'); panel().appendChild(tmp); tmp.focus(); tmp.remove();
    reject(); await settle();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
  });
  it('a flip to read-only under the page question keeps focus on its Cancel', async () => {
    target = document.createElement('div'); document.body.appendChild(target);
    registry = createDirtyRegistry();
    const pageAsk = new PageAsk();
    const props = $state({ vid: 1, version: mkVersion(), editable: true, stillOnVid: () => true, onClose: vi.fn() });
    cmp = mount(VersionSettingsModal, { target, props,
      context: new Map<unknown, unknown>([[DIRTY_REGISTRY_KEY, registry], [PAGE_ASK_KEY, pageAsk]]) });
    flushSync(); await settle();
    type(input('Label'), 'L2');
    void pageAsk.guard().promise;
    flushSync(); await settle();
    const cancel = () => panel().querySelector<HTMLButtonElement>('.inline-confirm button.cancel');
    expect(cancel()).not.toBeNull();
    cancel()!.focus();
    props.version = mkVersion({ state: 'published' }); props.editable = false;
    flushSync(); await settle();
    expect(pageAsk.ask.open).toBe(true);
    expect(document.activeElement).toBe(cancel());
    pageAsk.ask.dismiss();
  });
});
