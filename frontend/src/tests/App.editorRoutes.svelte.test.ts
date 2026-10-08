import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import App from '../App.svelte';
import { session } from '../stores/session.svelte';
import { navigate, currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { clearEditorVersion } from '../stores/currentEditorVersion.svelte';
import { clearToasts } from '../stores/toasts.svelte';
import type { AdminTree, AdminTreeItem } from '../lib/types';

// Slice-5b T3b: a routing smoke test through the REAL App + router + store —
// the item route renders VersionEditPage's modal, Back returns to the tree,
// and another item opens. Only fetch is stubbed. It guards the shape of the
// 5a Back-freeze fix (one page instance, no swap), but jsdom does not
// reproduce the freeze itself even with the old clear-on-unmount restored.
vi.mock('../lib/auth.svelte', () => ({
  logout: vi.fn(async () => {}),
  getAuthConfig: vi.fn(async () => ({ send_pin_enabled: true })),
  bootstrapSession: vi.fn(async () => {}),
  requestPin: vi.fn(async () => {}),
  verifyPin: vi.fn(async () => ({})),
}));
Element.prototype.scrollIntoView = () => {};

const SEQ = '/courses/c/edit/v/1/blocks/10/sequences/20';
const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
const jres = (body: unknown, status = 200) => Promise.resolve({
  ok: status < 400, status, statusText: 'x',
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(''),
  headers: new Headers({ 'content-type': 'application/json' }),
} as unknown as Response);
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
// jsdom fires popstate for history.back() on the SECOND macrotask after the
// call (probed: one setTimeout(0) is not enough), so wait two timer hops.
const tick0 = () => new Promise((r) => setTimeout(r, 0));
async function waitPop() { await tick0(); await tick0(); await settle(); await settle(); }

function mkItem(id: number, over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id, sequence_id: 20, title: `Item ${id}`, slug: `i${id}`, order: id, type: 'static_page',
    content_md: `body ${id}`, content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  };
}
let tree: AdminTree;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
let errors: unknown[] = [];
const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); };
const onRejection = (e: PromiseRejectionEvent) => { errors.push(e.reason); };

beforeEach(async () => {
  __resetGuardsForTests();
  tree = {
    course: { id: 1, name: 'C', slug: 'c' },
    version: {
      id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
      max_quiz_attempts: 3, label: '', created_at: '2026-01-01T00:00:00Z',
      published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z',
    },
    blocks: [{
      id: 10, version_id: 1, title: 'Block 10', slug: 'b10', order: 1, info: '', info_html: '',
      sequences: [{ id: 20, block_id: 10, title: 'Seq 20', slug: 's20', order: 1, items: [mkItem(30), mkItem(31)] }],
    }],
  };
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/admin-tree')) return jres(structuredClone(tree));
    if (u === '/api/sequences/20/items' && init?.method === 'POST') {
      tree.blocks[0].sequences[0].items.push(mkItem(99, { title: 'Fresh' }));
      return jres({ id: 99 });
    }
    if (u.endsWith('/assets')) return jres([]);
    return jres({});
  });
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  session.user = {
    id: 1, email: 'a@example.org', full_name: 'Admin', is_superuser: false, is_disabled: false,
    photo_url: null, has_course_admin: true, has_run_teacher: false,
  };
  session.loading = false;
  await navigate(SEQ, { force: true });
  errors = [];
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  target = document.createElement('div');
  document.body.appendChild(target);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  clearEditorVersion();
  clearToasts();
  session.user = null;
  __resetGuardsForTests();
  vi.restoreAllMocks();
});

const openBtn = (id: number) => target.querySelector<HTMLButtonElement>(`button[aria-label="Open Item ${id}"]`)!;

describe('App editor routes — item route → VersionEditPage modal (Slice-5b T3b smoke test)', () => {
  it('sequence → item → Back leaves a live page; a created item then opens in the modal', async () => {
    component = mount(App, { target });
    await settle();
    expect(target.querySelector('section.blocks')).not.toBeNull();

    // Stage 1 — the freeze.
    openBtn(30).click();
    await settle();
    expect(currentRoute.path).toBe(`${SEQ}/items/30`);
    history.back();
    await waitPop();
    expect(errors).toEqual([]);
    expect(currentRoute.path).toBe(SEQ);
    expect(target.querySelector('section.blocks')).not.toBeNull();   // the load ran: not stuck on the Skeleton
    [...target.querySelectorAll<HTMLButtonElement>('button.add-line')].find((b) => b.textContent!.includes('Add item'))!.click();
    await settle();
    const title = target.querySelector<HTMLInputElement>('section.modal-panel input[aria-label="Title"]');
    expect(title).not.toBeNull();                                   // the New item modal opens (5c D10)

    // Stage 2 — the modal.
    title!.value = 'Fresh';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    title!.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    await settle();
    expect(currentRoute.path).toBe(`${SEQ}/items/99`);
    expect(target.querySelector('section.modal-panel h2.item-name')?.textContent).toBe('Fresh');
    expect(errors).toEqual([]);
  });

  it('sequence → item → sequence → item keeps one live page', async () => {
    component = mount(App, { target });
    await settle();
    openBtn(30).click();
    await settle();
    history.back();
    await waitPop();
    expect(target.querySelector('section.blocks')).not.toBeNull();
    openBtn(31).click();
    await settle();
    expect(currentRoute.path).toBe(`${SEQ}/items/31`);
    expect(target.querySelector('section.modal-panel h2.item-name')?.textContent).toBe('Item 31');
    expect(errors).toEqual([]);
  });
});
