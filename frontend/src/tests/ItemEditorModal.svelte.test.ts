import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/ItemEditorModalHarness.svelte';
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
      vid: 1, version, perms: versionPermissions(version), seqIndex: 2,
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
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('ItemEditorModal — header and Title (T3a)', () => {
  it('header: covered mark, the name as the dialog label, the mono context and an enabled trash', async () => {
    await render();
    const name = panel().querySelector('h2.item-name')!;
    expect(name.textContent).toBe('Eigenvalues');
    expect(panel().getAttribute('aria-labelledby')).toBe(name.id);
    expect(panel().querySelector('.item-mark.covered')).not.toBeNull();
    const ctx = panel().querySelector('.item-ctx')!;
    expect(ctx.textContent).toBe('static page · S2 · item 3 of 4');
    expect(ctx.classList.contains('mono')).toBe(true);
    expect(trash().disabled).toBe(false);
    expect(trash().title).toBe('Delete this item');
  });

  it('Title is a plain, focused input with a 200-character cap', async () => {
    await render();
    expect(titleInput().value).toBe('Eigenvalues');
    expect(titleInput().maxLength).toBe(200);
    expect(document.activeElement).toBe(titleInput());
  });

  it('the trash calls onDeleteItem', async () => {
    await render();
    trash().click();
    expect(props.modal.onDeleteItem).toHaveBeenCalledTimes(1);
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
  it('clean: Save and Discard are disabled with reasons and nothing reads "unsaved changes"', async () => {
    await render();
    expect(footBtn('Save').disabled).toBe(true);
    expect(footBtn('Save').title).toBe('No changes to save');
    expect(footBtn('Discard').disabled).toBe(true);
    expect(footBtn('Discard').title).toBe('No changes to discard');
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
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
    expect(footBtn('Save').disabled).toBe(true);
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

  it('Save is disabled while an asset upload is in flight (busy interlock)', async () => {
    serve((u, init) => (u.endsWith('/assets') && init?.method === 'POST' ? new Promise(() => {}) : undefined));
    await render();
    type(titleInput(), 'Eigen');
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    textarea().dispatchEvent(ev);
    await settle();
    // The title is dirty, so only the in-flight upload can be disabling Save.
    expect(footBtn('Save').disabled).toBe(true);
    expect(footBtn('Discard').disabled).toBe(true);
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
    expect(panel().querySelector('div.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(closeBtn().disabled).toBe(true);
    expect(footBtn('Save').disabled).toBe(true);
    expect(trash().disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.modal.onRequestClose).not.toHaveBeenCalled();
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

  it('disabled quiz: expanding a question makes zero /render calls', async () => {
    await render({ item: { type: 'quiz' }, version: { is_disabled: true } });
    panel().querySelector<HTMLButtonElement>('[data-testid="question-header"] button.expand')!.click();
    await settle();
    expect(panel().querySelectorAll('[data-testid="markdown-plain"]').length).toBe(2);
    expect(calls(/\/render$/, 'POST').length).toBe(0);
    expect(calls(/\/assets/).length).toBe(0);
  });
});

describe('ItemEditorModal — interim wiring (T3a → T4 / T5a)', () => {
  it('quiz: a question draft makes the item guard-dirty only; the footer stays clean', async () => {
    await render({ item: { type: 'quiz' } });
    expect(panel().querySelector('[data-testid="quiz-title"]')).toBeNull();  // showTitle={false}
    panel().querySelector<HTMLButtonElement>('[data-testid="question-header"] button.expand')!.click();
    await settle();
    type(panel().querySelector<HTMLTextAreaElement>('.question textarea')!, 'Edited');
    await settle();
    expect(anyDirty()).toBe('true');
    expect(dirtyText()).toBe('');
    expect(footBtn('Save').disabled).toBe(true);
  });

  it('quiz: the footer Save sends the title alone', async () => {
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Quiz 2' }]);
    expect(dirtyText()).toBe('');
    expect(toastTexts()).toContain('Saved');
  });

  it('app: the script editor mounts without its own title on an enabled version', async () => {
    await render({ item: { type: 'interactive_app' } });
    expect(panel().querySelector('.app-editor')).not.toBeNull();
    expect(panel().querySelector('.app-editor h3')).toBeNull();
  });

  it('app: nothing is mounted or fetched on a disabled version', async () => {
    await render({ item: { type: 'interactive_app', script_url: 'app.js' }, version: { is_disabled: true } });
    expect(panel().querySelector('.app-editor')).toBeNull();
    expect(calls(/\/assets/).length).toBe(0);
  });
});

describe('ItemEditorModal — video body (T3c)', () => {
  const WATCH = 'https://www.youtube.com/watch?v=abc123';
  const EMBED = 'https://www.youtube.com/embed/abc123';
  const urlInput = () => panel().querySelector<HTMLInputElement>('input[aria-label="Video URL"]')!;

  it('shows the Video URL field with its hint; editing marks the footer dirty', async () => {
    await render({ item: { type: 'video', content_md: null, video_url: EMBED } });
    expect(panel().querySelector('.item-ctx')!.textContent).toBe('video · S2 · item 3 of 4');
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
