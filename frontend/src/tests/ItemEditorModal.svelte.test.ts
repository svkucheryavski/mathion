import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/ItemEditorModalHarness.svelte';
import AppBody from '../components/editor/item/AppBody.svelte';
import * as editorStore from '../stores/currentEditorVersion.svelte';
import { toasts, clearToasts } from '../stores/toasts.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { versionPermissions } from '../lib/versionPermissions';
import type { AdminTreeItem, AdminTreeVersion } from '../lib/types';
import type { DirtyRegistry } from '../lib/dirtyRegistry.svelte';

// Real store, real bodies; only fetch is stubbed.
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function resp(body: unknown, status = 200) {
  return {
    ok: status < 400, status, statusText: 'x',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(resp(body, status));
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 3, label: '', created_at: '2026-01-01T00:00:00Z',
    published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function mkItem(over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id: 7, sequence_id: 3, title: 'Eigenvalues', slug: 'eig', order: 1, type: 'static_page',
    content_md: '# Hi', content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  };
}
const textQ = {
  id: 51, item_id: 7, text_md: 'What is $x$?', text_html: '<p>What is x?</p>', type: 'text_answer',
  order: 1, explanation_md: 'Because.', explanation_html: '', correct_numeric: null, precision: null, correct_text: 'x',
};

type Call = [string, RequestInit | undefined];
const calls = (re: RegExp, method = 'GET') =>
  (fetchSpy.mock.calls as Call[]).filter(([u, init]) => re.test(String(u)) && (init?.method ?? 'GET') === method);
const patchBodies = () => calls(/\/api\/items\/7$/, 'PATCH').map(([, init]) => JSON.parse(String(init!.body)));

function serve(extra: (url: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    const custom = extra(u, init);
    if (custom) return custom;
    if (u.endsWith('/admin-tree')) return jres({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] });
    if (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH') {
      // Echo what was sent, with the title trimmed (models server normalisation).
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      const echo = { ...mkItem(), ...sent };
      if (typeof sent.title === 'string') echo.title = sent.title.trim();
      return jres(echo);
    }
    if (u.endsWith('/questions')) return jres([textQ]);
    if (u.endsWith('/render')) return jres({ html: '<p>rendered</p>' });
    if (u.endsWith('/assets')) return jres([]);
    return jres({});
  });
}

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let registry: DirtyRegistry | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let props: any;

async function render(over: { item?: Partial<AdminTreeItem>; version?: Partial<AdminTreeVersion>; modal?: Record<string, unknown> } = {}) {
  const version = mkVersion(over.version);
  const p = $state({
    modal: {
      vid: 1, version, perms: versionPermissions(version), blockTitle: 'Vectors', seqTitle: 'Linear combinations',
      item: mkItem(over.item), itemIndex: 3, itemCount: 4,
      stillOnVid: () => true, onRequestClose: vi.fn(), onDeleteItem: vi.fn(), deleting: false,
      ...over.modal,
    },
    onRegistry: (r: DirtyRegistry) => { registry = r; },
  });
  props = p;
  cmp = mount(Harness, { target, props });
  await settle();
}

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  serve();
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  target.remove();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  clearEditorVersion();
  clearToasts();
  registry = null;
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
});

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const titleInput = () => panel().querySelector<HTMLInputElement>('input.plain-input[aria-label="Title"]')!;
const textarea = () => panel().querySelector<HTMLTextAreaElement>('textarea')!;
const trash = () => panel().querySelector<HTMLButtonElement>('button[aria-label="Delete item"]')!;
const closeBtn = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const footBtn = (label: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('footer.modal-foot button')].find((b) => b.textContent!.trim() === label)!;
const dirtyText = () => panel().querySelector('footer.modal-foot .dirty')!.textContent;
const anyDirty = () => target.querySelector('[data-testid="any-dirty"]')!.textContent;
const toastTexts = () => toasts.list.map((t) => t.message);
// The body-top question (Polish 1): #19, and the page question when there is no footer.
const bodyAsk = () => panel().querySelector<HTMLElement>('.modal-body > .ask-slot .inline-confirm');
const bodyAskBtn = (k: 'confirm' | 'cancel') => bodyAsk()?.querySelector<HTMLButtonElement>(`button.${k}`) ?? null;
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('ItemEditorModal — header and Title (T3a)', () => {
  it('header: covered mark, the name as the dialog label, the path context (5c D11) and an enabled trash', async () => {
    await render();
    const name = panel().querySelector('h2.item-name')!;
    expect(name.textContent).toBe('Eigenvalues');
    expect(panel().getAttribute('aria-labelledby')).toBe(name.id);
    expect(panel().querySelector('.item-mark.covered')).not.toBeNull();
    const ctx = panel().querySelector('.item-ctx')!;
    expect(ctx.textContent).toBe('Vectors › Linear combinations · item 3 of 4');
    expect(ctx.classList.contains('mono')).toBe(false);
    expect(trash().disabled).toBe(false);
    expect(trash().title).toBe('Delete this item');
  });

  it('Title is a plain, focused input with a 200-character cap', async () => {
    await render();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(titleInput().maxLength).toBe(200);
    expect(document.activeElement).toBe(titleInput());
  });

  it('#19: the trash asks at the top of the body; Cancel sends nothing and focuses the trash; Delete calls onDeleteItem once', async () => {
    await render();
    trash().click();
    flushSync();
    expect(bodyAsk()!.querySelector('.warning')!.textContent!.trim()).toBe('Delete item "Eigenvalues"? This cannot be undone.');
    expect(bodyAskBtn('confirm')!.textContent!.trim()).toBe('Delete');
    expect(bodyAskBtn('confirm')!.classList.contains('danger')).toBe(true);
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    expect(panel().querySelector('div.body-rest')!.hasAttribute('inert')).toBe(true);
    expect(bodyAsk()!.closest('[inert]')).toBeNull();
    expect(trash().getAttribute('aria-disabled')).toBe('true');
    expect(trash().title).toBe('Answer the question first');
    bodyAskBtn('cancel')!.click();
    await settle();
    expect(bodyAsk()).toBeNull();
    expect(props.modal.onDeleteItem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trash());
    trash().click();
    flushSync();
    bodyAskBtn('confirm')!.click();
    await settle();
    expect(props.modal.onDeleteItem).toHaveBeenCalledTimes(1);
    expect(bodyAsk()).toBeNull();
  });

  it('#19: Cancel after the right to delete went lands on ×, never <body> (whole-branch review)', async () => {
    await render();
    trash().click();
    flushSync();
    // The right to delete goes while it asks (the version was published elsewhere).
    const published = mkVersion({ state: 'published' });
    props.modal.version = published;
    props.modal.perms = versionPermissions(published);
    flushSync();
    bodyAskBtn('cancel')!.click();
    await settle();
    expect(bodyAsk()).toBeNull();
    expect(trash().disabled).toBe(true);
    expect(document.activeElement).toBe(closeBtn());
  });

  it('#19: while it asks, × and Esc go to its Cancel and never close', async () => {
    await render();
    trash().click();
    flushSync();
    closeBtn().focus();
    closeBtn().click();
    flushSync();
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    closeBtn().focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(document.activeElement).toBe(bodyAskBtn('cancel'));
    expect(props.modal.onRequestClose).not.toHaveBeenCalled();
  });

  it('#19 R49: the right to delete goes while it asks; Delete sends nothing and focus goes to × (never <body>)', async () => {
    await render();
    trash().click();
    flushSync();
    const published = mkVersion({ state: 'published' });
    props.modal.version = published;
    props.modal.perms = versionPermissions(published);
    flushSync();
    bodyAskBtn('confirm')!.click();
    await settle();
    expect(props.modal.onDeleteItem).not.toHaveBeenCalled();
    expect(bodyAsk()).toBeNull();
    expect(trash().disabled).toBe(true);
    expect(document.activeElement).toBe(closeBtn());
  });

  it('#19: the busy confirm holds focus while the delete runs; when it fails, focus goes to the trash (R54)', async () => {
    let finish!: () => void;
    const onDeleteItem = vi.fn(() => {
      props.modal.deleting = true;
      return new Promise<void>((r) => { finish = () => { props.modal.deleting = false; r(); }; });
    });
    await render({ modal: { onDeleteItem } });
    trash().click();
    flushSync();
    const confirm = bodyAskBtn('confirm')!;
    confirm.click();
    await settle();
    expect(onDeleteItem).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(confirm);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(closeBtn().disabled).toBe(true);
    finish();
    await settle();
    await settle();
    expect(bodyAsk()).toBeNull();
    expect(document.activeElement).toBe(trash());
  });

  it('trash reasons: the structure reason when published; "save or discard first" when dirty', async () => {
    await render({ version: { state: 'published' } });
    expect(trash().disabled).toBe(true);
    expect(trash().title).toBe('Only a created version can change its structure');
    unmount(cmp!); cmp = null;
    await render();
    type(titleInput(), 'Eigen');
    expect(trash().disabled).toBe(true);
    expect(trash().title).toBe('Delete this item — save or discard changes first');
  });
});

describe('ItemEditorModal — footer, Save, Discard (T3a, page body)', () => {
  // Polish 3 C7 point 2 (F3): blocked, not natively disabled, so they keep focus.
  it('a clean Save and Discard are aria-disabled, not disabled, and clicking them does nothing', async () => {
    await render();
    for (const label of ['Save', 'Discard']) {
      expect(footBtn(label).disabled).toBe(false);
      expect(footBtn(label).getAttribute('aria-disabled')).toBe('true');
    }
    expect(footBtn('Save').title).toBe('No changes to save');
    expect(footBtn('Discard').title).toBe('No changes to discard');
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
    const reload = vi.spyOn(editorStore, 'loadAdminTree');
    footBtn('Save').click();
    footBtn('Discard').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
    expect(titleInput().value).toBe('Eigenvalues');
  });

  it('editing the title marks the footer and the page registry dirty', async () => {
    await render();
    type(titleInput(), 'Eigen');
    expect(dirtyText()).toBe('unsaved changes');
    expect(footBtn('Save').disabled).toBe(false);
    expect(anyDirty()).toBe('true');
  });

  it('Save sends one PATCH, writes the echo back, reloads the tree, toasts and refreshes the asset list', async () => {
    await render();
    const listsBefore = calls(/\/api\/versions\/1\/assets$/).length;
    type(titleInput(), 'New title  ');
    type(textarea(), '# Changed');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'New title  ', content_md: '# Changed' }]);
    expect(titleInput().value).toBe('New title');          // the trimmed echo is written back
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
    expect(calls(/\/admin-tree$/).length).toBe(1);
    expect(toastTexts()).toContain('Saved');
    expect(calls(/\/api\/versions\/1\/assets$/).length).toBe(listsBefore + 1); // refreshKey++
  });

  it('a content-only change sends no title', async () => {
    await render();
    type(textarea(), 'body only');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ content_md: 'body only' }]);
  });

  it('a failed PATCH keeps the drafts, toasts the server message and does not reload', async () => {
    serve((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'Nope' }, 422) : undefined));
    await render();
    type(titleInput(), 'Eigen 2');
    footBtn('Save').click();
    await settle();
    expect(toastTexts()).toContain('Nope');
    expect(dirtyText()).toBe('unsaved changes');
    expect(calls(/\/admin-tree$/).length).toBe(0);
  });

  it('an empty title blocks Save: nothing is sent, the field shows its error and takes focus', async () => {
    await render();
    type(titleInput(), '   ');
    textarea().focus();
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(titleInput().getAttribute('aria-invalid')).toBe('true');
    expect(panel().querySelector('.field-err')!.textContent).toBe('Title is required');
    expect(document.activeElement).toBe(titleInput());
    expect(toastTexts()).toContain('Fix the highlighted fields');
  });

  it('Discard restores the saved title and content', async () => {
    await render();
    type(titleInput(), 'X');
    type(textarea(), 'Y');
    footBtn('Discard').click();
    flushSync();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(textarea().value).toBe('# Hi');
    expect(dirtyText()).toBe('');
  });

  it('⌘S in the textarea saves; while it runs inputs are readonly and focus stays in the textarea', async () => {
    let release!: () => void;
    serve((u, init) => {
      if (!(/\/api\/items\/7$/.test(u) && init?.method === 'PATCH')) return undefined;
      return new Promise((r) => { release = () => r(resp({ ...mkItem(), content_md: 'typed' })); });
    });
    await render();
    textarea().focus();
    type(textarea(), 'typed');
    const ev = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    textarea().dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(patchBodies()).toEqual([{ content_md: 'typed' }]);
    expect(textarea().hasAttribute('readonly')).toBe(true);
    expect(titleInput().hasAttribute('readonly')).toBe(true);
    // Polish 3 C7 point 1: busy keeps the spinner and stays focusable (flipped from disabled).
    expect(footBtn('Save').disabled).toBe(false);
    expect(document.activeElement).toBe(textarea());
    release();
    await settle();
    expect(textarea().hasAttribute('readonly')).toBe(false);
    expect(document.activeElement).toBe(textarea());
  });

  it('⌘S outside the dialog does nothing', async () => {
    await render();
    type(titleInput(), 'Eigen');
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(patchBodies()).toEqual([]);
    outside.remove();
  });

  // ---- Polish 3 C7 (F3): focus after a Save, and ⌘S with focus on <body>.
  const cmdS = (on: EventTarget) => {
    const ev = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    on.dispatchEvent(ev);
    return ev;
  };

  it('⌘S with focus on body saves once and is defaultPrevented', async () => {
    await render();
    type(titleInput(), 'Eigen');
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    const ev = cmdS(document.body);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(patchBodies()).toEqual([{ title: 'Eigen' }]);
    type(titleInput(), 'Eigen 2');
    (document.activeElement as HTMLElement).blur();
    const ev2 = cmdS(document.documentElement);
    await settle();
    expect(ev2.defaultPrevented).toBe(true);
    expect(patchBodies()).toEqual([{ title: 'Eigen' }, { title: 'Eigen 2' }]);
  });

  // r2 Opus 2: from <body>, a clean modal and an open question still swallow ⌘S.
  it('⌘S with focus on body on a clean modal, or while a question asks, is prevented and sends nothing', async () => {
    await render();
    (document.activeElement as HTMLElement).blur();
    expect(cmdS(document.body).defaultPrevented).toBe(true);
    await settle();
    expect(patchBodies()).toEqual([]);
    // The delete question asks (clean, so the trash is live); then a change.
    trash().click();
    await settle();
    expect(bodyAsk()).not.toBeNull();
    type(titleInput(), 'Eigen');
    (document.activeElement as HTMLElement).blur();
    expect(cmdS(document.body).defaultPrevented).toBe(true);
    await settle();
    expect(patchBodies()).toEqual([]);
  });

  // r2 Fable 2: the busy Save is never labelled "No changes to save".
  it('during the refresh after a save, the busy Save has no "nothing to save" title', async () => {
    let releaseTree!: () => void;
    serve((u) => (u.endsWith('/admin-tree')
      ? new Promise<Response>((r) => { releaseTree = () => r(resp({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] })); })
      : undefined));
    await render();
    type(titleInput(), 'Eigen');
    footBtn('Save').click();
    await settle();
    expect(dirtyText()).toBe('');                       // the echo is in: clean
    expect(footBtn('Save').getAttribute('aria-busy')).toBe('true');
    expect(footBtn('Save').title).toBe('');
    releaseTree();
    await settle();
    expect(footBtn('Save').title).toBe('No changes to save');
  });

  it('a successful Save leaves focus on Save', async () => {
    await render();
    type(titleInput(), 'Eigen');
    footBtn('Save').focus();
    footBtn('Save').click();
    await settle();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Eigen' }]);
    expect(dirtyText()).toBe('');
    // A browser drops focus from a control that turns natively disabled; jsdom
    // does not, so the clean Save must stay enabled (aria-disabled) to hold it.
    expect(footBtn('Save').disabled).toBe(false);
    expect(document.activeElement).toBe(footBtn('Save'));
  });

  it('while saving, Save shows loading and is not natively disabled', async () => {
    let release!: () => void;
    serve((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH'
      ? new Promise<Response>((r) => { release = () => r(resp({ ...mkItem(), title: 'Eigen' })); })
      : undefined));
    await render();
    type(titleInput(), 'Eigen');
    footBtn('Save').focus();
    footBtn('Save').click();
    await settle();
    expect(footBtn('Save').getAttribute('aria-busy')).toBe('true');
    expect(footBtn('Save').disabled).toBe(false);
    expect(footBtn('Save').hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(footBtn('Save'));
    footBtn('Save').click();                  // busy: the handler returns at once
    await settle();
    expect(patchBodies().length).toBe(1);
    release();
    await settle();
  });

  it('a ⌘S with focus on Discard repairs focus to Save once the save settles', async () => {
    let release!: () => void;
    serve((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH'
      ? new Promise<Response>((r) => { release = () => r(resp({ ...mkItem(), title: 'Eigen' })); })
      : undefined));
    await render();
    type(titleInput(), 'Eigen');
    footBtn('Discard').focus();
    cmdS(footBtn('Discard'));
    await settle();
    expect(footBtn('Discard').disabled).toBe(true);   // frozen: it drops focus
    // A browser drops focus from it to <body>; jsdom keeps it (and blur() on a
    // disabled button is a no-op there), so drop it through a removed stand-in.
    const standIn = document.createElement('button');
    panel().appendChild(standIn);
    standIn.focus();
    standIn.remove();
    expect(document.activeElement).toBe(document.body);
    release();
    await settle();
    await settle();
    expect(document.activeElement).toBe(footBtn('Save'));
  });

  it('Save is blocked while an asset upload is in flight (busy interlock)', async () => {
    serve((u, init) => (u.endsWith('/assets') && init?.method === 'POST' ? new Promise(() => {}) : undefined));
    await render();
    type(titleInput(), 'Eigen');
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    textarea().dispatchEvent(ev);
    await settle();
    // The title is dirty, so only the in-flight upload can be blocking Save.
    // Polish 3 C7: blocked (aria-disabled), no longer natively disabled.
    expect(footBtn('Save').getAttribute('aria-disabled')).toBe('true');
    expect(footBtn('Discard').getAttribute('aria-disabled')).toBe('true');
    expect(footBtn('Save').disabled).toBe(false);
    // r1 (both lanes): focusable now, so it says why it does nothing.
    expect(footBtn('Save').title).toBe('Wait for the upload to finish');
    expect(footBtn('Discard').title).toBe('Wait for the upload to finish');
  });

  it('a confirmed close (registry discard) resets title and content', async () => {
    await render();
    type(titleInput(), 'X');
    type(textarea(), 'Y');
    registry!.discardAll();
    flushSync();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(textarea().value).toBe('# Hi');
    expect(anyDirty()).toBe('false');
  });
});

describe('ItemEditorModal — deleting freeze (T3a, D9)', () => {
  it('while deleting: body inert; ×, Save and trash disabled; Escape ignored', async () => {
    await render();
    type(titleInput(), 'Eigen');
    props.modal.deleting = true;
    flushSync();
    expect(panel().querySelector('div.body-rest')!.hasAttribute('inert')).toBe(true);
    expect(closeBtn().disabled).toBe(true);
    expect(footBtn('Save').disabled).toBe(true);
    expect(trash().disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.modal.onRequestClose).not.toHaveBeenCalled();
  });

  it('while a Save is in flight: × disabled and Escape ignored; both return when it settles', async () => {
    let release!: () => void;
    serve((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH'
      ? new Promise<Response>((r) => { release = () => r(resp({ ...mkItem(), title: 'Eigen' })); })
      : undefined));
    await render();
    type(titleInput(), 'Eigen');
    footBtn('Save').click();
    await settle();
    expect(closeBtn().disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.modal.onRequestClose).not.toHaveBeenCalled();
    release();
    await settle();
    await settle();
    expect(closeBtn().disabled).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.modal.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('deleting true → false returns focus to the trash', async () => {
    await render();
    props.modal.deleting = true;
    flushSync();
    props.modal.deleting = false;
    await settle();
    expect(document.activeElement).toBe(trash());
  });
});

describe('ItemEditorModal — read-only versions (T3a, D6)', () => {
  it('published: Title stays editable and the footer is shown', async () => {
    await render({ version: { state: 'published' } });
    expect(titleInput()).not.toBeNull();
    expect(panel().querySelector('footer.modal-foot')).not.toBeNull();
  });

  it('archived: title as text, no footer, × focused, the preview renders', async () => {
    await render({ version: { state: 'archived' } });
    expect(panel().querySelector('input.plain-input')).toBeNull();
    expect(panel().querySelector('.ro-value')!.textContent).toBe('Eigenvalues');
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    expect(document.activeElement).toBe(closeBtn());
    expect(calls(/\/render$/, 'POST').length).toBe(1);
    expect(panel().querySelector('.ro-note')).toBeNull();
  });

  it('disabled page: the D6 note and the plain source, with zero /render and zero asset calls', async () => {
    await render({ version: { is_disabled: true } });
    expect(panel().querySelector('.ro-note')!.textContent).toBe(
      'Preview is unavailable while this version is disabled — enable it to preview or edit.');
    expect(panel().querySelector('[data-testid="markdown-plain"]')!.textContent).toBe('# Hi');
    expect(calls(/\/render$/, 'POST').length).toBe(0);
    expect(calls(/\/assets/).length).toBe(0);
    expect(document.activeElement).toBe(closeBtn());
  });
});

describe('ItemEditorModal — app script row (T4)', () => {
  it('app: the App script row shows the filename with Replace and Remove; with none, Upload', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    expect(panel().querySelector('.script-name')!.textContent).toBe('app.js');
    expect(panel().querySelector('.script-name')!.classList.contains('mono')).toBe(true);
    const labels = [...panel().querySelectorAll<HTMLButtonElement>('.script-row button')].map((b) => b.textContent!.trim());
    expect(labels).toEqual(['Replace', 'Remove']);
    unmount(cmp!); cmp = null;
    await render({ item: { type: 'interactive_app', script_url: null } });
    expect(panel().querySelector('.script-name')!.textContent).toBe('No script');
    expect([...panel().querySelectorAll('.script-row button')].map((b) => b.textContent!.trim())).toEqual(['Upload']);
  });

  it('app: on a disabled version the script row is text, there is no preview card, and nothing is fetched', async () => {
    await render({ item: { type: 'interactive_app', script_url: 'app.js' }, version: { is_disabled: true } });
    expect(panel().querySelector('.script-name')!.textContent).toBe('app.js');
    expect(panel().querySelector('.script-row button')).toBeNull();
    expect(panel().querySelector('.app-preview')).toBeNull();
    expect(calls(/\/assets/).length).toBe(0);
  });
});

describe('ItemEditorModal — video body (T3c)', () => {
  const WATCH = 'https://www.youtube.com/watch?v=abc123';
  const EMBED = 'https://www.youtube.com/embed/abc123';
  const urlInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!;

  it('shows the Video URL field with its hint; editing marks the footer dirty', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    expect(panel().querySelector('.item-ctx')!.textContent).toBe('Vectors › Linear combinations · item 3 of 4');
    expect(urlInput().value).toBe(EMBED);
    expect(urlInput().classList.contains('mono')).toBe(true);
    expect(panel().querySelector('.field-hint')!.textContent).toBe(
      'Paste any YouTube or Vimeo URL — it is converted to embed form on save.');
    type(urlInput(), WATCH);
    expect(dirtyText()).toBe('unsaved changes');
  });

  it('a pasted watch URL is sent in embed form and the echo leaves the form clean', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), `  ${WATCH.replace('abc123', 'xyz789')}  `);
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ video_url: 'https://www.youtube.com/embed/xyz789' }]);
    expect(urlInput().value).toBe('https://www.youtube.com/embed/xyz789');
    expect(dirtyText()).toBe('');
    expect(toastTexts()).toContain('Saved');
  });

  it('an empty URL blocks Save with "Video URL is required" and focuses the field', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), '  ');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
    expect(panel().querySelector('.field-err')!.textContent).toBe('Video URL is required');
    expect(document.activeElement).toBe(urlInput());
  });

  // Polish 3 C18: validate() checks the value Save sends, by the backend's rules,
  // so a rejected URL shows under the field, not only as a toast.
  it('validate() checks the normalised value', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), 'example.com/v.mp4');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(panel().querySelector('.field-err')!.textContent).toBe('URL must start with http:// or https://');
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(urlInput());
    type(urlInput(), `https://example.com/${'v'.repeat(490)}`);
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([]);
    expect(panel().querySelector('.field-err')!.textContent).toBe('URL must be at most 500 characters');
    type(urlInput(), 'youtu.be/x');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ video_url: 'https://www.youtube.com/embed/x' }]);
    expect(panel().querySelector('.field-err')).toBeNull();
  });

  it('an upper-case scheme is sent lower-case, the rest as typed', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), 'HTTPS://Example.com/V.mp4');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ video_url: 'https://Example.com/V.mp4' }]);
  });

  it('a title-only change sends no video_url', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(titleInput(), 'Lecture 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Lecture 2' }]);
  });

  it('Discard restores the saved URL and clears the error', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    type(urlInput(), '');
    footBtn('Save').click();
    await settle();
    footBtn('Discard').click();
    flushSync();
    expect(urlInput().value).toBe(EMBED);
    expect(panel().querySelector('.field-err')).toBeNull();
  });

  it('disabled: the video note says editing (not preview) is unavailable; the preview stays, nothing is fetched', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED }, version: { is_disabled: true } });
    expect(panel().querySelector('.ro-note')!.textContent).toBe(
      'Editing is unavailable while this version is disabled — enable it to edit.');
    expect(panel().querySelector('iframe')!.getAttribute('src')).toBe(EMBED);
    expect(calls(/\/render$/, 'POST').length).toBe(0);
    expect(calls(/\/assets/).length).toBe(0);
  });

  it('archived: the URL is mono text and the preview still shows', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED }, version: { state: 'archived' } });
    expect(urlInput()).toBeNull();
    const ro = panel().querySelector('.ro-value.mono')!;
    expect(ro.textContent).toBe(EMBED);
    expect(panel().querySelector('iframe')!.getAttribute('src')).toBe(EMBED);
  });
});

describe('ItemEditorModal — ported from ItemEditPage.interactive (T3b)', () => {
  it('app: the fetched script previews in the sandboxed frame; there is no URL form', async () => {
    serve((u) => (u.includes('/assets/')
      ? Promise.resolve({ ok: true, status: 200, statusText: 'x', text: () => Promise.resolve("getElementById('app-root')") } as unknown as Response)
      : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    expect(panel().querySelector('iframe')?.getAttribute('srcdoc')).toContain("getElementById('app-root')");
    expect(panel().querySelector('input[type="url"]')).toBeNull();
  });

  it('app: with no script the empty upload state shows', async () => {
    await render({ item: { type: 'interactive_app', script_url: null } });
    expect(panel().textContent).toContain('No app uploaded yet.');
  });
});

describe('ItemEditorModal — video preview card (T4, D13)', () => {
  const EMBED = 'https://www.youtube.com/embed/abc123';
  const urlInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!;

  it('a resolvable URL: the 296px frame, the provider meta, "embed resolved" and Open in new tab', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    const card = panel().querySelector('.video-preview')!;
    expect(card.querySelector('.preview-meta')!.textContent).toBe('youtube');
    const frame = card.querySelector<HTMLElement>('.preview-area .frame')!;
    expect(frame.classList.contains('fixed')).toBe(true);
    expect(frame.style.getPropertyValue('--frame-h')).toBe('296px');
    expect(card.querySelector('.preview-status')!.textContent).toBe('embed resolved');
    const link = card.querySelector<HTMLAnchorElement>('a.open-link')!;
    expect(link.textContent).toBe('Open in new tab');
    expect(link.getAttribute('href')).toBe(EMBED);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('the provider meta reads vimeo and embed for those hosts', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: 'https://player.vimeo.com/video/42' } });
    expect(panel().querySelector('.preview-meta')!.textContent).toBe('vimeo');
    unmount(cmp!); cmp = null;
    await render({ item: { type: 'video', content_md: null, video_url: 'https://media.example.org/v/1' } });
    expect(panel().querySelector('.preview-meta')!.textContent).toBe('embed');
  });

  it('no embeddable URL: "No preview", the no-embed status, no link and no meta', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: 'not a url' } });
    const card = panel().querySelector('.video-preview')!;
    expect(card.querySelector('iframe')).toBeNull();
    expect(card.querySelector('.preview-empty')!.textContent).toBe('No preview');
    expect(card.querySelector('.preview-status')!.textContent).toBe('no embed — paste a YouTube or Vimeo link');
    expect(card.querySelector('a')).toBeNull();
    expect(card.querySelector('.preview-meta')).toBeNull();
  });

  it('the preview follows the URL 500ms after the last keystroke', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
      type(urlInput(), 'https://vimeo.com/77');
      vi.advanceTimersByTime(499);
      flushSync();
      expect(panel().querySelector('iframe')!.getAttribute('src')).toBe(EMBED);
      vi.advanceTimersByTime(1);
      flushSync();
      expect(panel().querySelector('iframe')!.getAttribute('src')).toBe('https://player.vimeo.com/video/77');
      expect(panel().querySelector('.preview-meta')!.textContent).toBe('vimeo');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ItemEditorModal — app body (T4; ported from InteractiveAppEditor)', () => {
  const APP_ASSET = {
    id: 5, version_id: 1, filename: 'new.js', file_size: 3, mime_type: 'application/javascript',
    uploaded_at: '', uploaded_by: 1, is_referenced: false,
  };
  const jsFile = (text: string, name = 'new.js') => new File([text], name, { type: 'application/javascript' });
  // jsdom fires FileReader.onload on a macrotask: drain macrotasks until `cond` holds.
  async function waitUntil(cond: () => boolean, tries = 60): Promise<void> {
    for (let i = 0; i < tries; i++) {
      flushSync();
      if (cond()) return;
      await new Promise((r) => setTimeout(r));
      await Promise.resolve();
    }
    flushSync();
  }
  function chooseFile(file: File) {
    const input = panel().querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));   // Svelte delegates onchange: must bubble
  }
  const scriptBtn = (label: string) =>
    [...panel().querySelectorAll<HTMLButtonElement>('.script-row button')].find((b) => b.textContent!.trim() === label)!;
  // #9: the remove question, in place of Replace / Remove.
  const scriptAsk = () => panel().querySelector<HTMLElement>('.script-row .inline-confirm');
  const uploadBtn = () => panel().querySelector<HTMLButtonElement>('.script-row [data-action="app-upload"]');
  // §Focus past a frozen row: the modal's ×, or its panel while × is disabled (saving).
  const modalOut = () => {
    const x = panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
    return x.disabled ? panel() : x;
  };
  const uploadPosts = () => calls(/\/api\/versions\/1\/assets$/, 'POST');
  const serveUpload = (extra: (u: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) =>
    serve((u, init) => extra(u, init) ?? (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? jres(APP_ASSET) : undefined));

  it('Upload links the script, reloads the tree and toasts', async () => {
    serveUpload();
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => calls(/\/admin-tree$/).length > 0);
    await settle();
    expect(uploadPosts().length).toBe(1);
    expect(patchBodies()).toEqual([{ script_url: 'new.js' }]);
    expect(toastTexts()).toContain('App uploaded');
  });

  it('busy: while the upload is out, Save is blocked and the script buttons are disabled', async () => {
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? new Promise(() => {}) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    type(titleInput(), 'App 2');
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => uploadPosts().length > 0);
    // Polish 3 C7: Save is blocked (aria-disabled), no longer natively disabled.
    expect(footBtn('Save').getAttribute('aria-disabled')).toBe('true');
    expect(scriptBtn('Upload').disabled).toBe(true);
  });

  it('surfaces the heuristic warnings (non-blocking) and still uploads', async () => {
    serveUpload();
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("import x from 'y'; fetch('/z')", 'm.js'));
    await waitUntil(() => calls(/\/admin-tree$/).length > 0);
    expect(panel().querySelector('.warnings')!.textContent).toContain('ES module');
    expect(panel().querySelector('.warnings')!.textContent).toContain('Network');
    expect(uploadPosts().length).toBe(1);
  });

  it('rejects an empty file before uploading', async () => {
    serveUpload();
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile('', 'empty.js'));
    await waitUntil(() => !!panel().querySelector('.field-err'));
    expect(panel().querySelector('.field-err')!.textContent).toContain('empty');
    expect(uploadPosts().length).toBe(0);
  });

  it('a duplicate filename (409) shows the rename message', async () => {
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? jres({ detail: 'dupe' }, 409) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')", 'dupe.js'));
    await waitUntil(() => !!panel().querySelector('.field-err'));
    expect(panel().querySelector('.field-err')!.textContent).toContain('already exists');
  });

  it("a proxy's 413 (an HTML page) says the server's upload limit (Settings D11a)", async () => {
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST'
      ? Promise.resolve(new Response('<html><body>413 Request Entity Too Large</body></html>', { status: 413, headers: { 'content-type': 'text/html' } }))
      : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')", 'big.js'));
    await waitUntil(() => !!panel().querySelector('.field-err'));
    expect(panel().querySelector('.field-err')!.textContent).toContain("This file is over the server's upload limit.");
  });

  it('a failed link deletes the orphaned asset and does not reload', async () => {
    serveUpload((u, init) => (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'boom' }, 500) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => calls(/\/api\/assets\/5$/, 'DELETE').length > 0);
    await settle();
    expect(calls(/\/admin-tree$/).length).toBe(0);
    expect(panel().querySelector('.field-err')).not.toBeNull();
  });

  it('a linked asset is kept when only the tree refresh fails', async () => {
    serveUpload();
    const load = vi.spyOn(editorStore, 'loadAdminTree').mockRejectedValue(new Error('refresh down'));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')", 'ok.js'));
    await waitUntil(() => load.mock.calls.length > 0);
    await settle();
    expect(patchBodies()).toEqual([{ script_url: 'new.js' }]);
    expect(calls(/\/api\/assets\/5$/, 'DELETE').length).toBe(0);
  });

  it('#9: Remove asks in place of Replace / Remove; Cancel sends nothing and returns to Remove; Remove unlinks, reloads and toasts', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    const ask = scriptAsk()!;
    expect(ask.querySelector('.warning')!.textContent!.trim()).toBe('Remove the app script? Students will see an empty app.');
    expect(ask.classList.contains('row')).toBe(true);
    expect([...ask.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Remove', 'Cancel']);
    expect(ask.querySelector('button.confirm')!.classList.contains('danger')).toBe(true);
    expect(scriptBtn('Replace')).toBeUndefined();
    expect(document.activeElement).toBe(ask.querySelector('button.cancel'));
    ask.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(patchBodies()).toEqual([]);
    expect(document.activeElement).toBe(scriptBtn('Remove'));
    scriptBtn('Remove').click();
    await settle();
    scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    await settle();
    expect(patchBodies()).toEqual([{ script_url: null }]);
    expect(calls(/\/admin-tree$/).length).toBe(1);
    expect(toastTexts()).toContain('App removed');
    expect(scriptAsk()).toBeNull();
    expect(document.activeElement).toBe(uploadBtn());
  });

  it('#9: while the remove runs, focus is on the busy Remove; a failure shows the error and returns to the first button', async () => {
    let fail!: () => void;
    serve((u, init) => {
      if (u.includes('/assets/')) return Promise.resolve(resp("getElementById('app-root')"));
      if (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH') {
        return new Promise<Response>((r) => { fail = () => r(resp({ detail: 'Nope' }, 422)); });
      }
      return undefined;
    });
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    const ok = scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!;
    expect(document.activeElement).toBe(ok);
    expect(ok.getAttribute('aria-busy')).toBe('true');
    ok.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(scriptAsk()).not.toBeNull();       // Esc is ignored while busy
    fail();
    await settle();
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(panel().querySelector('.field-err')!.textContent).toBe('Nope');
    expect(document.activeElement).toBe(uploadBtn());   // "Replace": the script stayed
    expect(uploadBtn()!.textContent!.trim()).toBe('Replace');
  });

  it('#9 R49: the script going while it asks (a tree reload) withdraws the question; focus goes to Upload', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    props.modal.item = mkItem({ type: 'interactive_app', script_url: null });
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(document.activeElement).toBe(uploadBtn());
    expect(uploadBtn()!.textContent!.trim()).toBe('Upload');
    expect(patchBodies()).toEqual([]);
  });

  it('#9 R49: the right to edit going while it asks withdraws the question for good; focus goes to × (never <body>)', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    expect(document.activeElement).toBe(scriptAsk()!.querySelector('button.cancel'));
    const archived = mkVersion({ state: 'archived' });
    props.modal.version = archived;
    props.modal.perms = versionPermissions(archived);
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(document.activeElement).toBe(panel().querySelector('header.modal-head button[aria-label="Close"]'));
    const draft = mkVersion();
    props.modal.version = draft;
    props.modal.perms = versionPermissions(draft);
    await settle();
    expect(scriptAsk()).toBeNull();          // the stale question never comes back
    expect(scriptBtn('Remove')).toBeDefined();
    expect(patchBodies()).toEqual([]);
  });

  it('#9 R49: a footer Save freezing the row while it asks; Remove withdraws, focus never drops to <body>', async () => {
    serve((u, init) => {
      if (u.includes('/assets/')) return Promise.resolve(resp("getElementById('app-root')"));
      if (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH') return new Promise<Response>(() => {});
      return undefined;
    });
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    type(titleInput(), 'App 2');
    scriptBtn('Remove').click();
    await settle();
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'App 2' }]);
    scriptAsk()!.querySelector<HTMLButtonElement>('button.confirm')!.click();
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(patchBodies()).toEqual([{ title: 'App 2' }]);   // the remove sent nothing
    expect(document.activeElement).toBe(modalOut());
  });

  it('#9: Cancel while a footer Save freezes the row; focus never drops to <body>', async () => {
    serve((u, init) => {
      if (u.includes('/assets/')) return Promise.resolve(resp("getElementById('app-root')"));
      if (/\/api\/items\/7$/.test(u) && init?.method === 'PATCH') return new Promise<Response>(() => {});
      return undefined;
    });
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    type(titleInput(), 'App 2');
    scriptBtn('Remove').click();
    await settle();
    footBtn('Save').click();
    await settle();
    scriptAsk()!.querySelector<HTMLButtonElement>('button.cancel')!.click();
    await settle();
    expect(scriptAsk()).toBeNull();
    expect(scriptBtn('Remove').disabled).toBe(true);
    expect(document.activeElement).toBe(modalOut());
  });

  it('the footer Save sends the title alone', async () => {
    await render({ item: { type: 'interactive_app', script_url: null } });
    type(titleInput(), 'App 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'App 2' }]);
    expect(dirtyText()).toBe('');
  });

  it('the ready preview: the 360px frame, the meta, and the blank-preview hint in the card footer', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    await settle();
    const card = panel().querySelector('.app-preview')!;
    expect(card.querySelector('.preview-meta')!.textContent).toBe('interactive app');
    const frame = card.querySelector<HTMLElement>('.frame')!;
    expect(frame.classList.contains('fixed')).toBe(true);
    expect(frame.style.getPropertyValue('--frame-h')).toBe('360px');
    expect(card.querySelector('.blank-hint')!.textContent).toContain('Blank preview?');
  });

  it('read-only with no script: "No app." and no script buttons', async () => {
    await render({ item: { type: 'interactive_app', script_url: null }, version: { state: 'archived' } });
    expect(panel().querySelector('.app-hint')!.textContent).toBe('No app.');
    expect(panel().querySelector('.script-row button')).toBeNull();
  });

  it("a failed source fetch: \"couldn't be loaded\", and the stored filename is never a link", async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp('', 404)) : undefined));
    await render({ item: { type: 'interactive_app', script_url: 'app.js' }, version: { state: 'archived' } });
    await settle();
    expect(panel().querySelector('iframe')).toBeNull();
    expect(panel().querySelector('.app-hint')!.textContent).toBe("This app couldn't be loaded.");
    expect(panel().querySelectorAll('a').length).toBe(0);
  });

  it('closing the modal mid-upload still links the script and throws nothing', async () => {
    let release!: () => void;
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST'
      ? new Promise<Response>((r) => { release = () => r(resp(APP_ASSET)); }) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => uploadPosts().length > 0);
    unmount(cmp!); cmp = null;
    release();
    await waitUntil(() => patchBodies().length > 0);
    await settle();
    expect(patchBodies()).toEqual([{ script_url: 'new.js' }]);
    expect(calls(/\/api\/assets\/5$/, 'DELETE').length).toBe(0);
  });

  // Polish 3 C18 (slice5b T4): a title Save reloads the tree, which hands the
  // body a fresh `item` with the same script; the preview must not restart.
  it('a title Save makes no second /assets GET', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = $state<{ item: AdminTreeItem | undefined; vid: number; editable: boolean; versionDisabled: boolean; frozen: boolean; stillOnVid: () => boolean }>({
      item: mkItem({ type: 'interactive_app', script_url: 'app.js' }), vid: 1, editable: true,
      versionDisabled: false, frozen: false, stillOnVid: () => true,
    });
    const c = mount(AppBody, { target: host, props: p });
    await settle();
    expect(calls(/\/assets\//).length).toBe(1);
    p.item = mkItem({ type: 'interactive_app', script_url: 'app.js', title: 'Renamed' });   // the reloaded tree's copy
    await settle();
    expect(calls(/\/assets\//).length).toBe(1);
    p.item = mkItem({ type: 'interactive_app', script_url: 'other.js' });   // a new script still re-previews
    await settle();
    expect(calls(/\/assets\//).length).toBe(2);
    unmount(c);
    host.remove();
  });

  it('AppBody tolerates `item` going undefined (a dying branch re-running its effect)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const p = $state<{ item: AdminTreeItem | undefined; vid: number; editable: boolean; versionDisabled: boolean; frozen: boolean; stillOnVid: () => boolean }>({
      item: mkItem({ type: 'interactive_app', script_url: 'app.js' }), vid: 1, editable: true,
      versionDisabled: false, frozen: false, stillOnVid: () => true,
    });
    const c = mount(AppBody, { target: host, props: p });
    await settle();
    expect(() => { p.item = undefined; flushSync(); }).not.toThrow();
    unmount(c);
    host.remove();
  });
});
