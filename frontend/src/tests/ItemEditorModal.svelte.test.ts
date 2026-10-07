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

  it('disabled quiz: expanding a question makes zero /render calls', async () => {
    await render({ item: { type: 'quiz' }, version: { is_disabled: true } });
    panel().querySelector<HTMLButtonElement>('[data-testid="question-header"] button[aria-expanded]')!.click();
    await settle();
    expect(panel().querySelectorAll('[data-testid="markdown-plain"]').length).toBe(2);
    expect(calls(/\/render$/, 'POST').length).toBe(0);
    expect(calls(/\/assets/).length).toBe(0);
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

  it('busy: while the upload is out, Save and the script buttons are disabled', async () => {
    serveUpload((u, init) => (/\/api\/versions\/1\/assets$/.test(u) && init?.method === 'POST' ? new Promise(() => {}) : undefined));
    await render({ item: { type: 'interactive_app', script_url: null } });
    type(titleInput(), 'App 2');
    chooseFile(jsFile("getElementById('app-root')"));
    await waitUntil(() => uploadPosts().length > 0);
    expect(footBtn('Save').disabled).toBe(true);
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

  it('Remove confirms first: Cancel sends nothing; OK unlinks, reloads and toasts', async () => {
    serve((u) => (u.includes('/assets/') ? Promise.resolve(resp("getElementById('app-root')")) : undefined));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await render({ item: { type: 'interactive_app', script_url: 'app.js' } });
    scriptBtn('Remove').click();
    await settle();
    expect(confirmSpy).toHaveBeenCalledWith('Remove the app script? Students will see an empty app.');
    expect(patchBodies()).toEqual([]);
    confirmSpy.mockReturnValue(true);
    scriptBtn('Remove').click();
    await settle();
    await settle();
    expect(patchBodies()).toEqual([{ script_url: null }]);
    expect(calls(/\/admin-tree$/).length).toBe(1);
    expect(toastTexts()).toContain('App removed');
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

describe('ItemEditorModal — quiz body (T5a)', () => {
  const numQ = { ...textQ, id: 52, type: 'numeric_answer', correct_text: null, correct_numeric: 3, precision: 0 };
  const choiceQ = { ...textQ, id: 53, type: 'single_choice', correct_text: null };
  const choiceOpts = [
    { id: 61, question_id: 53, text: 'A', is_correct: true, order: 1 },
    { id: 62, question_id: 53, text: 'B', is_correct: false, order: 2 },
  ];
  const tail = (u: unknown) => String(u).replace(/^.*\/api\//, '');
  const qPatches = () => calls(/\/api\/questions\/\d+$/, 'PATCH').map(([u, init]) => [tail(u), JSON.parse(String(init!.body))]);
  const optPatches = () => calls(/\/api\/options\/\d+$/, 'PATCH').map(([u, init]) => [tail(u), JSON.parse(String(init!.body))]);
  // The quiz endpoints. A question or option PATCH echoes what was sent over
  // the stored row (the server's echo); `extra` overrides a URL first.
  function serveQuiz(questions: Record<string, unknown>[], extra: (u: string, init?: RequestInit) => Promise<Response> | undefined = () => undefined) {
    serve((u, init) => {
      const custom = extra(u, init);
      if (custom) return custom;
      if (u.endsWith('/items/7/questions')) return jres(questions);
      if (u.endsWith('/questions/53/options')) return jres(choiceOpts);
      const qm = /\/api\/questions\/(\d+)$/.exec(u);
      if (qm && init?.method === 'PATCH') return jres({ ...questions.find((x) => x.id === Number(qm[1])), ...JSON.parse(String(init.body)) });
      const om = /\/api\/options\/(\d+)$/.exec(u);
      if (om && init?.method === 'PATCH') return jres({ ...choiceOpts.find((x) => x.id === Number(om[1])), ...JSON.parse(String(init.body)) });
      return undefined;
    });
  }
  const toggle = (i = 0) => panel().querySelectorAll<HTMLButtonElement>('[data-testid="question-header"] button[aria-expanded]')[i];
  async function expand(i = 0) { toggle(i).click(); await settle(); }
  const answerInput = () => panel().querySelector<HTMLInputElement>('[data-testid="text-answer-input"]')!;

  it('a question draft marks the footer and the page registry dirty (the T3a stop-gap bridge is gone)', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    expect(panel().querySelector('[data-testid="quiz-title"]')).toBeNull();
    await expand();
    type(answerInput(), 'z');
    expect(dirtyText()).toBe('unsaved changes');
    expect(anyDirty()).toBe('true');
    expect(footBtn('Save').disabled).toBe(false);
  });

  it('Save sends the title, then the question; the trimmed answer comes back clean', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    await expand();
    type(answerInput(), '  y  ');
    footBtn('Save').click();
    await settle();
    const order = (fetchSpy.mock.calls as Call[]).filter(([, i]) => i?.method === 'PATCH').map(([u]) => tail(u));
    expect(order).toEqual(['items/7', 'questions/51']);
    expect(patchBodies()).toEqual([{ title: 'Quiz 2' }]);
    expect(qPatches()).toEqual([['questions/51', { correct_text: 'y' }]]);
    expect(answerInput().value).toBe('y');
    expect(dirtyText()).toBe('');
    expect(anyDirty()).toBe('false');
    expect(toastTexts()).toContain('Saved');
    expect(calls(/\/admin-tree$/).length).toBe(1);
  });

  it('the footer Save sends the title alone when no question changed', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    footBtn('Save').click();
    await settle();
    expect(patchBodies()).toEqual([{ title: 'Quiz 2' }]);
    expect(qPatches()).toEqual([]);
    expect(dirtyText()).toBe('');
  });

  it('a numeric "2.50" saves as 2.5 and comes back clean', async () => {
    serveQuiz([numQ]);
    await render({ item: { type: 'quiz' } });
    await expand();
    const num = panel().querySelector<HTMLInputElement>('[data-testid="numeric-input"]')!;
    type(num, '2.50');
    footBtn('Save').click();
    await settle();
    expect(qPatches()).toEqual([['questions/52', { correct_numeric: 2.5, precision: 0 }]]);
    expect(num.value).toBe('2.5');
    expect(dirtyText()).toBe('');
  });

  it('⌘S in an option input saves; meanwhile the input is readonly with focus kept and the marks are disabled', async () => {
    let release!: () => void;
    serveQuiz([choiceQ], (u, init) => {
      if (!(/\/api\/options\/61$/.test(u) && init?.method === 'PATCH')) return undefined;
      return new Promise((r) => { release = () => r(resp({ ...choiceOpts[0], text: 'A2' })); });
    });
    await render({ item: { type: 'quiz' } });
    await expand();
    const optA = panel().querySelectorAll<HTMLInputElement>('[data-testid="option-text"]')[0];
    optA.focus();
    type(optA, 'A2');
    const ev = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
    optA.dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(optPatches()).toEqual([['options/61', { text: 'A2' }]]);
    expect(optA.readOnly).toBe(true);
    expect(document.activeElement).toBe(optA);
    const radios = [...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.every((r) => r.disabled)).toBe(true);
    radios[1].click();                              // a disabled input ignores click()
    flushSync();
    expect(radios[0].checked).toBe(true);
    release();
    await settle();
    expect(optA.readOnly).toBe(false);
    expect(document.activeElement).toBe(optA);
    expect(dirtyText()).toBe('');
  });

  it('footer Discard and a confirmed close both reset question drafts', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    await expand();
    type(answerInput(), 'z');
    footBtn('Discard').click();
    flushSync();
    expect(answerInput().value).toBe('x');
    expect(dirtyText()).toBe('');
    type(answerInput(), 'w');
    registry!.discardAll();
    flushSync();
    expect(answerInput().value).toBe('x');
    expect(anyDirty()).toBe('false');
  });

  it('a question failing after the title saved is partial: the tree reloads, the toast names it, it stays dirty', async () => {
    serveQuiz([textQ], (u, init) => (/\/api\/questions\/51$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'Nope' }, 422) : undefined));
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    await expand();
    type(answerInput(), 'z');
    footBtn('Save').click();
    await settle();
    expect(toastTexts()).toContain('Question 1: Nope — Save again to send the rest.');
    expect(toastTexts()).not.toContain('Saved');
    expect(calls(/\/admin-tree$/).length).toBe(1);        // the title part landed → reload (D10)
    expect(titleInput().value).toBe('Quiz 2');
    expect(dirtyText()).toBe('unsaved changes');          // the question is still dirty
    expect(answerInput().value).toBe('z');
  });

  it('a question landing part of its PATCHes before failing is partial: the tree reloads (D10)', async () => {
    serveQuiz([choiceQ], (u, init) => (/\/api\/options\/61$/.test(u) && init?.method === 'PATCH' ? jres({ detail: 'Boom' }, 422) : undefined));
    await render({ item: { type: 'quiz' } });
    await expand();
    panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();   // move the key A → B
    await settle();
    footBtn('Save').click();
    await settle();
    await settle();
    expect(optPatches()).toEqual([['options/62', { is_correct: true }], ['options/61', { is_correct: false }]]);
    expect(toastTexts()).toContain('Question 1: Boom — Save again to send the rest.');
    expect(calls(/\/admin-tree$/).length).toBe(1);        // B:true landed → reload (D10)
    expect(dirtyText()).toBe('unsaved changes');
  });

  it('a key move whose modal unmounts mid-save still sends the rest of the option plan (no two-correct key)', async () => {
    let releaseB!: () => void;
    serveQuiz([choiceQ], (u, init) => (/\/api\/options\/62$/.test(u) && init?.method === 'PATCH'
      ? new Promise<Response>((r) => { releaseB = () => r(resp({ ...choiceOpts[1], is_correct: true })); })
      : undefined));
    await render({ item: { type: 'quiz' } });
    await expand();
    panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click();   // move the key A → B
    await settle();
    footBtn('Save').click();
    await settle();
    // Browser Back can't be frozen: the page guard confirms, discards, and the route unmounts the modal.
    registry!.discardAll();
    unmount(cmp!);
    cmp = null;
    releaseB();
    await settle();
    await settle();
    expect(optPatches()).toEqual([['options/62', { is_correct: true }], ['options/61', { is_correct: false }]]);
  });

  it('an invalid question blocks Save: nothing is sent; it is expanded, marked and focused', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    await expand();
    type(answerInput(), '');
    await expand();                                       // collapse it again
    footBtn('Save').click();
    await settle();
    expect(qPatches()).toEqual([]);
    expect(patchBodies()).toEqual([]);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[data-testid="needs-fixing"]')!.textContent).toBe('needs fixing');
    expect(document.activeElement).toBe(answerInput());
    expect(toastTexts()).toContain('Fix the highlighted fields');
  });

  // ---- Structure with drafts (Slice-5b T5b) ----
  it('a typed add-question form makes closing prompt but leaves the footer clean; a confirmed close collapses it', async () => {
    serveQuiz([textQ]);
    await render({ item: { type: 'quiz' } });
    panel().querySelector<HTMLButtonElement>('button[aria-label="Add question"]')!.click();
    flushSync();
    type(panel().querySelector<HTMLInputElement>('[data-testid="new-question-text"]')!, 'Half-typed');
    expect(anyDirty()).toBe('true');
    expect(dirtyText()).toBe('');
    expect(footBtn('Save').disabled).toBe(true);
    expect(trash().disabled).toBe(true);                    // D9: guard-dirty blocks the delete
    registry!.discardAll();
    flushSync();
    expect(panel().querySelector('[data-testid="new-question-text"]')).toBeNull();
    expect(anyDirty()).toBe('false');
  });

  it('Save is disabled while a question add is in flight, even with a dirty title', async () => {
    serveQuiz([textQ], (u, init) =>
      (u.endsWith('/items/7/questions') && init?.method === 'POST' ? new Promise<Response>(() => {}) : undefined));
    await render({ item: { type: 'quiz' } });
    type(titleInput(), 'Quiz 2');
    expect(footBtn('Save').disabled).toBe(false);
    panel().querySelector<HTMLButtonElement>('button[aria-label="Add question"]')!.click();
    flushSync();
    type(panel().querySelector<HTMLInputElement>('[data-testid="new-question-text"]')!, 'Pick one');
    [...panel().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === 'Add')!.click();
    await settle();
    expect(footBtn('Save').disabled).toBe(true);
  });
});
