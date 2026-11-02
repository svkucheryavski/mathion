// Slice-5d: the real ItemEditorModal (through ItemEditorModalHarness, which
// provides the page's DirtyRegistry) over an in-memory quiz server. Only fetch
// is stubbed. The server models the backend rules the editor relies on: D12's
// single-choice clear, the last-correct 422, server-side order.
import { mount, unmount, flushSync } from 'svelte';
import { vi } from 'vitest';
import Harness from './ItemEditorModalHarness.svelte';
import { versionPermissions } from '../../lib/versionPermissions';
import { clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
import { toasts, clearToasts } from '../../stores/toasts.svelte';
import type { AdminTreeItem, AdminTreeVersion } from '../../lib/types';
import type { AuthoringOption, AuthoringQuestion } from '../../lib/quizAuthoring';
import type { DirtyRegistry } from '../../lib/dirtyRegistry.svelte';

export function resp(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status, statusText: 'x',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
// 30 microtask rounds: a failed answer write runs request → track → locked's
// awaited reload → send → track → commit before the field shows its error.
// Intermediate states are always tested with hold(), so a deep settle hides nothing.
export async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); flushSync(); }

export function q(over: Partial<AuthoringQuestion> & { id: number }): AuthoringQuestion {
  return {
    item_id: 7, text_md: `Q${over.id}`, text_html: `<p>Q${over.id}</p>`, type: 'single_choice', order: over.id,
    explanation_md: null, explanation_html: null, correct_numeric: null, precision: null, correct_text: null,
    ...over,
  };
}
export function opt(id: number, question_id: number, text: string, is_correct = false, order = id): AuthoringOption {
  return { id, question_id, text, is_correct, order };
}
export function mkVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 3, label: '', created_at: '2026-01-01T00:00:00Z',
    published_at: null, archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
function quizItem(over: Partial<AdminTreeItem> = {}): AdminTreeItem {
  return {
    id: 7, sequence_id: 3, title: 'Test me', slug: 'test-me', order: 1, type: 'quiz',
    content_md: null, content_html: '', video_url: null, script_url: null, questions_count: 0, ...over,
  } as AdminTreeItem;
}

type Call = { method: string; path: string; body: unknown };
type Handler = (path: string, method: string) => Promise<Response> | undefined;
const html = (md: string | null) => (md == null ? null : `<p>${md}</p>`);

export class QuizServer {
  questions: AuthoringQuestion[];
  options: AuthoringOption[];
  calls: Call[] = [];
  #next = 1000;
  #holds: Handler[] = [];

  constructor(questions: AuthoringQuestion[] = [], options: AuthoringOption[] = []) {
    this.questions = structuredClone(questions);
    this.options = structuredClone(options);
  }

  /** Writes only (GETs are noise). */
  writes(): Call[] { return this.calls.filter((c) => c.method !== 'GET'); }

  /** The next matching request waits until release(), or answers fail(status, detail). */
  hold(method: string, re: RegExp) {
    let open!: (r: Response | null) => void;
    const gate = new Promise<Response | null>((r) => { open = r; });
    let used = false;
    this.#holds.push((path, m) => {
      if (used || m !== method || !re.test(path)) return undefined;
      used = true;
      return gate.then((r) => r ?? this.#route(path, m, this.#pendingBody.get(path)));
    });
    return {
      release: () => open(null),
      fail: (status: number, detail: string) => open(resp({ detail }, status)),
    };
  }
  /** The next matching request fails at once. */
  failNext(method: string, re: RegExp, status: number, detail: string) {
    this.hold(method, re).fail(status, detail);
  }

  #pendingBody = new Map<string, unknown>();

  handle(url: string, init?: RequestInit): Promise<Response> {
    const path = url.replace(/^.*?(\/api\/)/, '$1');
    const method = init?.method ?? 'GET';
    // JSON bodies are parsed; an upload's FormData is kept as is.
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    this.calls.push({ method, path, body });
    this.#pendingBody.set(path, body);
    for (const h of this.#holds) {
      const r = h(path, method);
      if (r) return r;
    }
    return Promise.resolve(this.#route(path, method, body));
  }

  #q(id: number) { return this.questions.find((x) => x.id === id); }
  #opts(qid: number) { return this.options.filter((o) => o.question_id === qid).sort((a, b) => a.order - b.order); }

  #route(path: string, method: string, body: any): Response {   // eslint-disable-line @typescript-eslint/no-explicit-any
    let m: RegExpExecArray | null;
    if (path.endsWith('/admin-tree')) {
      return resp({ course: { id: 1, name: 'C', slug: 'c' }, version: mkVersion(), blocks: [] });
    }
    if (path.endsWith('/render')) return resp({ html: '<p>rendered</p>' });
    if (/\/assets/.test(path)) return resp([]);
    if (path === '/api/items/7' && method === 'PATCH') {
      return resp({ ...quizItem(), ...body, title: String(body.title).trim() });
    }
    if (path === '/api/items/7/questions' && method === 'GET') {
      return resp(structuredClone([...this.questions].sort((a, b) => a.order - b.order)));
    }
    if (path === '/api/items/7/questions' && method === 'POST') {
      const created = q({
        id: this.#next++, ...body, order: Math.max(0, ...this.questions.map((x) => x.order)) + 1,
        text_html: html(body.text_md)!, explanation_html: html(body.explanation_md ?? null),
      });
      this.questions.push(created);
      return resp(structuredClone(created), 201);
    }
    if (path === '/api/items/7/questions/reorder') {
      for (const e of body.order as { id: number; order: number }[]) this.#q(e.id)!.order = e.order;
      return resp({ status: 'ok' });
    }
    if ((m = /^\/api\/questions\/(\d+)$/.exec(path))) {
      const qq = this.#q(Number(m[1]));
      if (!qq) return resp({ detail: 'Question not found' }, 404);
      if (method === 'DELETE') {
        this.questions = this.questions.filter((x) => x !== qq);
        this.options = this.options.filter((o) => o.question_id !== qq.id);
        return resp(null, 204);
      }
      Object.assign(qq, body);
      if ('text_md' in body) qq.text_html = html(body.text_md)!;
      if ('explanation_md' in body) qq.explanation_html = html(body.explanation_md);
      return resp(structuredClone(qq));
    }
    if ((m = /^\/api\/questions\/(\d+)\/options$/.exec(path))) {
      const qid = Number(m[1]);
      if (method === 'GET') return resp(structuredClone(this.#opts(qid)));
      const created = opt(this.#next++, qid, body.text, body.is_correct,
        Math.max(0, ...this.#opts(qid).map((o) => o.order)) + 1);
      if (created.is_correct && this.#q(qid)!.type === 'single_choice') {
        for (const o of this.#opts(qid)) o.is_correct = false;
      }
      this.options.push(created);
      return resp(structuredClone(created), 201);
    }
    if ((m = /^\/api\/questions\/(\d+)\/options\/reorder$/.exec(path))) {
      for (const e of body.order as { id: number; order: number }[]) {
        this.options.find((o) => o.id === e.id)!.order = e.order;
      }
      return resp({ status: 'ok' });
    }
    if ((m = /^\/api\/options\/(\d+)$/.exec(path))) {
      const o = this.options.find((x) => x.id === Number(m![1]));
      if (!o) return resp({ detail: 'Option not found' }, 404);
      if (method === 'DELETE') { this.options = this.options.filter((x) => x !== o); return resp(null, 204); }
      const qq = this.#q(o.question_id)!;
      if (body.is_correct === false && this.#opts(qq.id).filter((x) => x.is_correct && x !== o).length === 0) {
        return resp({ detail: 'At least one option must be correct' }, 422);
      }
      Object.assign(o, body);
      if (body.is_correct === true && qq.type === 'single_choice') {
        for (const x of this.#opts(qq.id)) if (x !== o) x.is_correct = false;
      }
      return resp(structuredClone(o));
    }
    return resp({});
  }
}

let mounted: { cmp: ReturnType<typeof mount>; target: HTMLElement } | null = null;
const originalFetch = globalThis.fetch;

export async function renderQuiz(
  server: QuizServer,
  over: { version?: Partial<AdminTreeVersion>; item?: Partial<AdminTreeItem>; page?: boolean } = {},
) {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => server.handle(String(url), init)) as unknown as typeof fetch;
  const target = document.createElement('div');
  document.body.appendChild(target);
  const version = mkVersion(over.version);
  let registry: DirtyRegistry | null = null;
  const onRequestClose = vi.fn();
  const onDeleteItem = vi.fn();
  const props = $state({
    modal: {
      vid: 1, version, perms: versionPermissions(version), blockTitle: 'Vectors', seqTitle: 'Linear combination',
      item: quizItem(over.item), itemIndex: 3, itemCount: 4,
      stillOnVid: () => true, onRequestClose, onDeleteItem, deleting: false,
    },
    onRegistry: (r: DirtyRegistry) => { registry = r; },
    withPage: over.page ?? false,
  });
  const cmp = mount(Harness, { target, props });
  mounted = { cmp, target };
  await settle();
  return {
    props, onRequestClose, onDeleteItem,
    registry: () => registry!,
    anyDirty: () => target.querySelector('[data-testid="any-dirty"]')!.textContent,
    // The page closes the modal: unmount it, but keep fetch and the toasts.
    closeModal() { if (mounted) { unmount(mounted.cmp); mounted.target.remove(); mounted = null; } },
  };
}

export function cleanup() {
  if (mounted) { unmount(mounted.cmp); mounted.target.remove(); mounted = null; }
  globalThis.fetch = originalFetch;
  clearEditorVersion();
  clearToasts();
  document.documentElement.style.overflow = '';
  vi.restoreAllMocks();
}

// ---- DOM helpers ----
/** The quiz modal (level 2): the first dialog in document order. */
export const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
/** The top dialog: a level-3 modal when one is open. */
export const topPanel = () => { const all = document.querySelectorAll<HTMLElement>('section.modal-panel'); return all[all.length - 1]!; };
export const cards = () => [...panel().querySelectorAll<HTMLElement>('li.qcard')];
export const rows = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>('li.ans-row')];
/** A button by accessible name: aria-label, else its whitespace-collapsed text. */
export function byName(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.getAttribute('aria-label') ?? b.textContent!.replace(/\s+/g, ' ').trim()) === name);
}
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
export function press(el: Element, key: string, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(e);
  flushSync();
  return e;
}
export const live = () => panel().querySelector('[data-testid="quiz-live"]')!.textContent;
export const toastTexts = () => toasts.list.map((t) => t.message);
export const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
