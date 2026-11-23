import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../lib/olx/readExport', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/olx/readExport')>();
  return { ...real, readExport: vi.fn() };
});
vi.mock('../lib/olx/run', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/olx/run')>();
  return {
    ...real,
    uploadAll: vi.fn(real.uploadAll),
    markPresent: vi.fn(real.markPresent),
    assembleBuildBody: vi.fn(real.assembleBuildBody),
  };
});
vi.mock('../lib/router.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/router.svelte')>();
  return { ...real, navigate: vi.fn() };
});

import OlxImportModal from '../components/editor/OlxImportModal.svelte';
import { readExport, ReadError } from '../lib/olx/readExport';
import { assembleBuildBody, markPresent, reportText, uploadAll } from '../lib/olx/run';
import { navigate } from '../lib/router.svelte';
import type { GuardAsk } from '../lib/askInPlace.svelte';
import { blobKey, type CheckResponse, type ReportLine } from '../lib/olx/types';
import type { Version } from '../lib/types';
import { clearToasts, toasts } from '../stores/toasts.svelte';

type Reply = { status: number; body?: unknown } | 'network';
type Queued = Reply | (() => Promise<Response>);

const MB = 1024 * 1024;
const CONFIG = { send_pin_enabled: true, longest_sign_in_days: 30, max_file_mb: 20, max_total_mb: 200, branding: {} };
const CHECK_URL = 'POST /api/courses/3/olx-import/check';
const DRAFT_URL = 'POST /api/courses/3/versions';
const UP = 'POST /api/versions/9/assets';
const LIST = 'GET /api/versions/9/assets';
const BUILD = 'POST /api/versions/9/olx-import/build';
const STATUS = 'GET /api/versions/9/olx-import/status';
const discardUrl = (id: number) => `POST /api/versions/${id}/olx-import/discard`;

let routes: Record<string, Queued[]>;
let calls: { key: string; body?: unknown; file?: string }[];
let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;

function respond(r: Reply): Response {
  if (r === 'network') throw new TypeError('Failed to fetch');
  if (r.status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
}

/** A reply the test releases later. */
function deferred(): { item: () => Promise<Response>; release: (r: Reply) => void } {
  let release!: (r: Reply) => void;
  const p = new Promise<Reply>((r) => { release = r; });
  return { item: () => p.then(respond), release };
}

beforeEach(() => {
  routes = {};
  calls = [];
  clearToasts();
  vi.mocked(readExport).mockReset();
  vi.mocked(navigate).mockReset();
  vi.mocked(uploadAll).mockClear();
  vi.mocked(markPresent).mockClear();
  vi.mocked(assembleBuildBody).mockClear();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const call: (typeof calls)[number] = { key };
    if (init?.body instanceof FormData) call.file = (init.body.get('file') as File).name;
    else if (typeof init?.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);
    const next = routes[key]?.shift();
    if (!next) throw new Error(`unexpected fetch ${key}`);
    return typeof next === 'function' ? next() : respond(next);
  });
});

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = null;
  target?.remove();
  document.documentElement.style.overflow = '';
  vi.unstubAllGlobals();
});

async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); flushSync(); }

function mkVersion(over: Partial<Version> = {}): Version {
  return {
    id: 1, course_id: 3, state: 'created', is_disabled: false, info_md: '', info_html: '', max_quiz_attempts: 3, label: 'v',
    created_at: '2026-01-01T00:00:00Z', published_at: null, archived_at: null, ...over,
  };
}

type Props = {
  courseId: number; courseSlug: string; versions: Version[]; onClose: () => void;
  onBusyChange: (busy: boolean) => void; registerAsk: (guard: (() => GuardAsk) | null) => void;
};
let props: Props;
async function render(over: Partial<Props> = {}) {
  routes['GET /api/auth/config'] ??= [];
  if (routes['GET /api/auth/config'].length === 0) routes['GET /api/auth/config'].push({ status: 200, body: CONFIG });
  target = document.createElement('div');
  document.body.appendChild(target);
  props = { courseId: 3, courseSlug: 'c', versions: [], onClose: vi.fn(), onBusyChange: vi.fn(), registerAsk: vi.fn(), ...over };
  cmp = mount(OlxImportModal, { target, props });
  await settle();
}

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const act = (a: string) => panel().querySelector<HTMLButtonElement>(`[data-action="${a}"]`);
const text = (sel: string) => panel().querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const askText = () => text('footer.modal-foot .inline-confirm .warning');
const askBtn = (which: 'confirm' | 'cancel') => panel().querySelector<HTMLButtonElement>(`footer.modal-foot .inline-confirm button.${which}`)!;

const READ_LINES: ReportLine[] = [{ level: 'skipped', where: '', text: 'reader line' }];
function readResult() {
  return {
    body: { files: { 'course.xml': '<course/>' }, static: [{ path: 'a.pdf', size: 3, skipped: null }, { path: 'b.pdf', size: 3, skipped: null }], apps: [] },
    blobs: new Map<string, Blob>([[blobKey('static', 'a.pdf'), new Blob(['abc'])], [blobKey('static', 'b.pdf'), new Blob(['def'])]]),
    report: READ_LINES.map((l) => ({ ...l })),
    jsonBytes: 100,
  };
}
const SUMMARY = { blocks: 4, sequences: 11, items: 167, videos: 107, pages: 11, apps: 22, quizzes: 27, files: 2, bytes: 95 * MB };
function checkResponse(over: Partial<CheckResponse> = {}): CheckResponse {
  return {
    summary: SUMMARY, report: [{ level: 'note', where: 'Week 1', text: 'server line' }], blockers: [],
    uploads: [{ source: 'a.pdf', target: 'a.pdf', kind: 'static', size: 3 }, { source: 'b.pdf', target: 'b.pdf', kind: 'static', size: 3 }],
    linked: ['a.pdf'], max_quiz_attempts: 4, label: 'Open edX (unfinished): Chem', blocking: false, ...over,
  };
}
const asset = (filename: string, size = 3) => ({
  id: 1, version_id: 9, filename, file_size: size, mime_type: 'application/pdf', uploaded_at: '', uploaded_by: 1, is_referenced: false,
});
const BUILT = { report: [{ level: 'changed', where: 'Week 1 › Intro', text: 'built line' }], label: 'Open edX: Chem (2026-11-22)' };

function pick(name = 'course.tar.gz') {
  const input = panel().querySelector<HTMLInputElement>('input[data-role="export"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], name)], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/** Open the modal, pick an export and reach the check state. */
async function toCheck(check: CheckResponse = checkResponse(), over: Partial<Props> = {}) {
  vi.mocked(readExport).mockResolvedValue(readResult());
  routes[CHECK_URL] = [{ status: 200, body: check }];
  await render(over);
  pick();
  act('check')!.click();
  await settle();
}

/** From the check state, start the import with the given upload and build replies. */
async function startImport(replies: Partial<Record<string, Queued[]>> = {}) {
  routes[DRAFT_URL] = replies[DRAFT_URL] ?? [{ status: 201, body: mkVersion({ id: 9, label: 'Open edX (unfinished): Chem' }) }];
  routes[UP] = replies[UP] ?? [{ status: 201, body: asset('a.pdf') }, { status: 201, body: asset('b.pdf') }];
  if (replies[LIST]) routes[LIST] = replies[LIST]!;
  routes[BUILD] = replies[BUILD] ?? [{ status: 200, body: BUILT }];
  if (replies[STATUS]) routes[STATUS] = replies[STATUS]!;
  act('import')!.click();
  await settle();
}

describe('OlxImportModal — opening', () => {
  it('stops with the limits sentence when the config lacks a limit', async () => {
    routes['GET /api/auth/config'] = [{ status: 200, body: { ...CONFIG, max_total_mb: undefined } }];
    await render();
    expect(text('.olx-error')).toBe("Could not read the site's file limits. Try again.");
    expect(panel().querySelector('input[data-role="export"]')).toBeNull();
    expect(act('check')).toBeNull();
  });

  it('a failed config fetch shows the limits sentence', async () => {
    routes['GET /api/auth/config'] = [{ status: 500, body: { detail: 'Boom' } }];
    await render();
    expect(text('.olx-error')).toBe("Could not read the site's file limits. Try again.");
    expect(act('check')).toBeNull();
  });

  it('lists unfinished drafts with Delete and deletes one', async () => {
    const versions = [
      mkVersion({ id: 5, label: 'Open edX (unfinished): Chem' }),
      mkVersion({ id: 6, label: 'Open edX (unfinished): Bio', state: 'published' }),
      mkVersion({ id: 7, label: 'Spring' }),
      mkVersion({ id: 8, label: 'Open edX (unfinished): Phys' }),
    ];
    routes[discardUrl(5)] = [{ status: 204 }];
    await render({ versions });
    const rows = () => [...panel().querySelectorAll('.olx-drafts li')].map((li) => li.querySelector('.olx-draft-label')!.textContent);
    expect(rows()).toEqual(['Open edX (unfinished): Chem', 'Open edX (unfinished): Phys']);
    panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Chem"]')!.click();
    await settle();
    expect(rows()).toEqual(['Open edX (unfinished): Phys']);
    expect(calls.map((c) => c.key)).toEqual(['GET /api/auth/config', discardUrl(5)]);
  });

  it('the unfinished list follows the page list as it reloads, and says an import in another tab shows too', async () => {
    routes['GET /api/auth/config'] = [{ status: 200, body: CONFIG }];
    target = document.createElement('div');
    document.body.appendChild(target);
    const live = $state<Props>({ courseId: 3, courseSlug: 'c', versions: [], onClose: vi.fn(), onBusyChange: vi.fn(), registerAsk: vi.fn() });
    props = live;
    cmp = mount(OlxImportModal, { target, props: live });
    await settle();
    expect(panel().querySelector('.olx-drafts')).toBeNull();
    live.versions = [mkVersion({ id: 5, label: 'Open edX (unfinished): Chem' }), mkVersion({ id: 8, label: 'Open edX (unfinished): Phys' })];
    flushSync();
    const rows = () => [...panel().querySelectorAll('.olx-draft-label')].map((e) => e.textContent);
    expect(rows()).toEqual(['Open edX (unfinished): Chem', 'Open edX (unfinished): Phys']);
    expect(text('.olx-drafts')).toContain('An import still running in another tab shows here too; deleting it stops that import.');
    routes[discardUrl(5)] = [{ status: 204 }];
    panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Chem"]')!.click();
    await settle();
    live.versions = [...live.versions];
    flushSync();
    expect(rows()).toEqual(['Open edX (unfinished): Phys']);
  });

  it('Delete in the drafts list uses discard; a 409 keeps the draft and says so', async () => {
    routes[discardUrl(5)] = [{ status: 409, body: { detail: 'kept' } }];
    routes[discardUrl(8)] = [{ status: 500, body: { detail: 'Boom' } }];
    await render({ versions: [mkVersion({ id: 5, label: 'Open edX (unfinished): Chem' }), mkVersion({ id: 8, label: 'Open edX (unfinished): Phys' })] });
    panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Chem"]')!.click();
    await settle();
    expect([...panel().querySelectorAll('.olx-draft-label')].map((e) => e.textContent)).toEqual(['Open edX (unfinished): Phys']);
    expect(text('.olx-drafts-note')).toBe('“Open edX (unfinished): Chem” was built meanwhile, so it was kept.');
    panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Phys"]')!.click();
    await settle();
    expect([...panel().querySelectorAll('.olx-draft-label')].map((e) => e.textContent)).toEqual(['Open edX (unfinished): Phys']);
    expect(text('.olx-drafts-note')).toBe('Could not delete “Open edX (unfinished): Phys”. Try again.');
    expect(calls.some((c) => c.key.startsWith('DELETE'))).toBe(false);
  });
});

describe('OlxImportModal — check', () => {
  it('check state shows the summary, blockers and report; Import disabled when blocking', async () => {
    await toCheck();
    expect(vi.mocked(readExport)).toHaveBeenCalledWith(expect.objectContaining({ name: 'course.tar.gz' }), [], { maxFileBytes: 20 * MB, maxTotalBytes: 200 * MB });
    expect(calls.find((c) => c.key === CHECK_URL)!.body).toEqual(readResult().body);
    expect(text('.olx-summary')).toBe('4 blocks, 11 sequences, 167 items: 107 videos, 11 pages, 22 apps, 27 quizzes; 2 files, 95 MB');
    expect(panel().querySelector('.olx-blockers')).toBeNull();
    expect(act('import')!.disabled).toBe(false);
    if (cmp) unmount(cmp);
    cmp = null;
    target.remove();
    await toCheck(checkResponse({ blocking: true, blockers: [{ level: 'skipped', where: '', text: 'More than 8 blocks' }] }));
    expect(text('.olx-blockers')).toContain('More than 8 blocks');
    expect(text('.olx-foot-note')).toBe('Fix the problems above in Open edX, then export again.');
    expect(act('import')!.disabled).toBe(true);
  });

  it('the summary says one of each in the singular', async () => {
    const one = { blocks: 1, sequences: 1, items: 1, videos: 1, pages: 1, apps: 1, quizzes: 1, files: 1, bytes: 1 };
    await toCheck(checkResponse({ summary: one }));
    expect(text('.olx-summary')).toBe('1 block, 1 sequence, 1 item: 1 video, 1 page, 1 app, 1 quiz; 1 file, 1 KB');
  });

  it('the summary shows sizes below 1 MB in KB', async () => {
    const sized = (bytes: number) => ({ blocks: 1, sequences: 1, items: 1, videos: 0, pages: 1, apps: 0, quizzes: 0, files: 3, bytes });
    for (const [bytes, size] of [[0, '0 KB'], [1300, '1 KB'], [240 * 1024, '240 KB'], [1023 * 1024, '1023 KB'], [1024 * 1024 - 1, '1 MB'], [1258291, '1 MB'], [5 * 1024 * 1024, '5 MB']] as const) {
      await toCheck(checkResponse({ summary: sized(bytes) }));
      expect(text('.olx-summary')).toBe(`1 block, 1 sequence, 1 item: 0 videos, 1 page, 0 apps, 0 quizzes; 3 files, ${size}`);
      if (cmp) unmount(cmp);
      cmp = null;
      target.remove();
    }
  });

  it('reader report lines are visible in the check state before Import', async () => {
    await toCheck();
    expect(props.registerAsk).not.toHaveBeenCalled();
    expect(text('.olx-report')).toContain('reader line');
    expect(text('.olx-report')).toContain('Week 1: server line');
    expect(act('import')).not.toBeNull();
  });

  it('a report too large to build stops at Check, before anything is sent', async () => {
    const r = readResult();
    r.report = Array.from({ length: 20001 }, () => ({ level: 'note' as const, where: '', text: 'x' }));
    vi.mocked(readExport).mockResolvedValue(r);
    await render();
    pick();
    act('check')!.click();
    await settle();
    expect(text('.olx-error')).toBe("This export's report is too large to import. Import fewer files.");
    expect(calls.some((c) => c.key === CHECK_URL)).toBe(false);
  });

  it('a read error stays in the pick state and says why', async () => {
    vi.mocked(readExport).mockRejectedValue(new ReadError('This file is not an Open edX export.'));
    await render();
    pick();
    act('check')!.click();
    await settle();
    expect(text('.olx-error')).toBe('This file is not an Open edX export.');
    expect(panel().querySelector('input[data-role="export"]')).not.toBeNull();
  });
});

describe('OlxImportModal — import', () => {
  it('import runs create → uploads → build and shows Done with Save report and Open the draft', async () => {
    await toCheck();
    await startImport();
    expect(calls.map((c) => c.key)).toEqual(['GET /api/auth/config', CHECK_URL, DRAFT_URL, UP, UP, BUILD]);
    expect(calls.find((c) => c.key === DRAFT_URL)!.body).toEqual({ info_md: '', max_quiz_attempts: 4, label: 'Open edX (unfinished): Chem' });
    expect(calls.filter((c) => c.key === UP).map((c) => c.file)).toEqual(['a.pdf', 'b.pdf']);
    const build = calls.find((c) => c.key === BUILD)!.body as { report: ReportLine[] };
    expect(build.report).toEqual(READ_LINES);
    expect(text('.olx-done')).toBe('Imported as “Open edX: Chem (2026-11-22)”.');
    expect(text('.olx-report')).toContain('Week 1 › Intro: built line');
    expect(act('save-report')).not.toBeNull();
    expect(act('open-draft')).not.toBeNull();
    expect(act('delete-draft')).toBeNull();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('Open the draft navigates in the same tab', async () => {
    await toCheck();
    await startImport();
    act('open-draft')!.click();
    expect(vi.mocked(navigate)).toHaveBeenCalledWith('/courses/c/edit/v/9');
  });

  it('Esc and backdrop do not close while importing; onBusyChange toggles', async () => {
    await toCheck();
    const d = deferred();
    await startImport({ [DRAFT_URL]: [d.item] });
    expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    expect(panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.querySelector<HTMLElement>('.modal-backdrop')!.click();
    expect(props.onClose).not.toHaveBeenCalled();
    d.release({ status: 201, body: mkVersion({ id: 9 }) });
    await settle();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('upload retry shows Retry, which resumes from the first missing file', async () => {
    await toCheck();
    await startImport({
      [UP]: [{ status: 201, body: asset('a.pdf') }, { status: 409, body: { detail: 'exists' } }, { status: 201, body: asset('b.pdf') }],
      [LIST]: [{ status: 200, body: [asset('a.pdf'), asset('b.pdf', 7)] }, { status: 200, body: [asset('a.pdf')] }],
    });
    expect(text('.olx-failed')).toBe('A different file named “b.pdf” is already in the draft. Press Retry to check again.');
    expect(act('retry')).not.toBeNull();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    act('retry')!.click();
    await settle();
    expect(calls.filter((c) => c.key === UP).map((c) => c.file)).toEqual(['a.pdf', 'b.pdf', 'b.pdf']);
    expect(act('open-draft')).not.toBeNull();
  });

  it('an upload that fails outright offers Delete, not Retry', async () => {
    await toCheck();
    await startImport({ [UP]: [{ status: 403, body: { detail: 'Version is disabled' } }] });
    expect(text('.olx-failed')).toBe('The file “a.pdf” could not be uploaded: Version is disabled');
    expect(act('retry')).toBeNull();
    expect(act('delete-draft')).not.toBeNull();
  });

  it('Retry calls markPresent, then uploadAll with the same progress', async () => {
    vi.mocked(uploadAll).mockResolvedValueOnce({ kind: 'retry', message: 'Try again later.' });
    await toCheck();
    await startImport({ [LIST]: [{ status: 200, body: [] }] });
    expect(text('.olx-failed')).toBe('Try again later.');
    act('retry')!.click();
    await settle();
    expect(vi.mocked(markPresent)).toHaveBeenCalledTimes(1);
    const first = vi.mocked(uploadAll).mock.calls[0][4];
    const second = vi.mocked(uploadAll).mock.calls[1][4];
    expect(second).toBe(first);
    expect(vi.mocked(markPresent).mock.calls[0][2]).toBe(first);
    expect(vi.mocked(markPresent).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(uploadAll).mock.invocationCallOrder[1]);
    expect(first).toMatchObject({ uncertain: expect.any(Set) });
    expect([...vi.mocked(uploadAll).mock.calls[0][3]]).toEqual(['a.pdf']);
  });

  it('a too-large build body shows Failed with Delete', async () => {
    vi.mocked(assembleBuildBody).mockReturnValueOnce({ kind: 'too-large', message: "This export's report is too large to build. Delete the draft and import fewer files." });
    await toCheck();
    await startImport();
    expect(text('.olx-failed')).toBe("This export's report is too large to build. Delete the draft and import fewer files.");
    expect(act('delete-draft')).not.toBeNull();
    expect(act('retry')).toBeNull();
    expect(calls.some((c) => c.key === BUILD)).toBe(false);
  });

  it('a build that answers 404 shows Failed without Delete', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 404, body: { detail: 'Version not found' } }] });
    expect(text('.olx-failed')).toBe('Version not found');
    expect(act('delete-draft')).toBeNull();
    expect(act('keep')).toBeNull();
    expect(panel().querySelector('.olx-keep-note')).toBeNull();
    expect(act('close')).not.toBeNull();
  });

  it('failed build offers Delete the unfinished draft and Keep', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'The import is blocked: x', blockers: [] } }] });
    expect(text('.olx-failed')).toBe('The import is blocked: x');
    expect(act('delete-draft')!.textContent!.trim()).toBe('Delete the unfinished draft');
    expect(act('keep')!.textContent!.trim()).toBe('Keep it');
    expect(act('retry')).toBeNull();
    expect(text('.olx-keep-note')).toContain('this import cannot be resumed');
    routes[discardUrl(9)] = [{ status: 204 }];
    act('delete-draft')!.click();
    await settle();
    expect(calls.at(-1)!.key).toBe(discardUrl(9));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(toasts.list.map((t) => t.message)).toContain('The unfinished draft was deleted.');
  });

  it('Keep closes and leaves the draft', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'The import is blocked: x', blockers: [] } }] });
    act('keep')!.click();
    await settle();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.key === discardUrl(9))).toBe(false);
  });

  it('a Delete answered 409 shows the draft as built', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'The import is blocked: x', blockers: [] } }] });
    routes[discardUrl(9)] = [{ status: 409, body: { detail: 'kept' } }];
    act('delete-draft')!.click();
    await settle();
    expect(text('.olx-done-note')).toBe('The draft was built, but its report could not be loaded.');
    expect(act('open-draft')).not.toBeNull();
  });

  it('a timed-out build shows Check again while running, never Delete', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 504 }], [STATUS]: [{ status: 200, body: { state: 'running' } }, { status: 200, body: { state: 'built' } }] });
    expect(text('.olx-running')).toBe('The import is still being built. Check again in a moment.');
    expect(act('check-again')).not.toBeNull();
    expect(act('delete-draft')).toBeNull();
    act('check-again')!.click();
    await settle();
    expect(calls.filter((c) => c.key === BUILD)).toHaveLength(1);
    expect(calls.at(-1)!.key).toBe(STATUS);
    expect(text('.olx-done-note')).toBe('The draft was built, but its report could not be loaded.');
    expect(act('delete-draft')).toBeNull();
  });

  it('committed-unknown shows Done without Delete', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 200, body: {} }] });
    expect(text('.olx-done-note')).toBe('The draft was built, but its report could not be loaded.');
    expect(act('delete-draft')).toBeNull();
    expect(act('save-report')).toBeNull();
    expect(act('open-draft')).not.toBeNull();
  });

  it('Save report downloads a .txt with the report text', async () => {
    let saved: Blob | null = null;
    const anchors: HTMLAnchorElement[] = [];
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: (b: Blob) => { saved = b; return 'blob:report'; },
      revokeObjectURL: () => {},
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this); });
    await toCheck();
    await startImport();
    act('save-report')!.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchors[0].download).toMatch(/\.txt$/);
    const blob = saved as unknown as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const body = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsText(blob); });
    expect(body).toBe(reportText(BUILT.report as ReportLine[], []));
    click.mockRestore();
  });
});

describe('OlxImportModal — leaving during an import', () => {
  async function importing() {
    await toCheck();
    const d = deferred();
    await startImport({ [DRAFT_URL]: [d.item] });
    const reg = vi.mocked(props.registerAsk).mock.calls;
    const factory = reg.at(-1)![0]!;
    expect(factory).toBeTypeOf('function');
    return { d, factory };
  }

  it('navigating away during an import asks inside the modal; confirm leaves, cancel stays', async () => {
    const { factory } = await importing();
    let g = factory();
    await settle();
    expect(askText()).toBe('An import is running. Leaving stops it and leaves an unfinished draft.');
    expect(askBtn('confirm').textContent!.trim()).toBe('Leave');
    askBtn('cancel').click();
    expect(await g.promise).toBe(false);
    await settle();
    expect(panel().querySelector('footer.modal-foot .inline-confirm')).toBeNull();
    g = factory();
    await settle();
    expect(askBtn('confirm').classList.contains('danger')).toBe(true);
    askBtn('confirm').click();
    expect(await g.promise).toBe(true);
    await settle();
    expect(panel().querySelector('footer.modal-foot .inline-confirm')).toBeNull();
  });

  it('the registered factory returns refused() and refocuses while its question is open', async () => {
    const { factory } = await importing();
    const first = factory();
    await settle();
    panel().focus();
    const second = factory();
    expect(await second.promise).toBe(false);
    expect(document.activeElement).toBe(askBtn('cancel'));
    expect(panel().querySelectorAll('footer.modal-foot .inline-confirm')).toHaveLength(1);
    askBtn('cancel').click();
    expect(await first.promise).toBe(false);
  });

  it('the question is dismissed and unregistered when the import ends or the modal unmounts', async () => {
    const { d, factory } = await importing();
    const g = factory();
    await settle();
    d.release({ status: 201, body: mkVersion({ id: 9 }) });
    await settle();
    expect(await g.promise).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(act('open-draft')).not.toBeNull();
    expect(vi.mocked(props.registerAsk).mock.calls.at(-1)![0]).toBeNull();
    expect(panel().querySelector('footer.modal-foot .inline-confirm')).toBeNull();
    unmount(cmp!);
    cmp = null;
    const again = await importing();
    const g2 = again.factory();
    await settle();
    vi.mocked(props.onBusyChange).mockClear();
    unmount(cmp!);
    cmp = null;
    expect(props.onBusyChange).toHaveBeenCalledWith(false);
    expect(await g2.promise).toBe(false);
    expect(vi.mocked(props.registerAsk).mock.calls.at(-1)![0]).toBeNull();
  });

  it('a confirmed leave stops the import and closes the modal even if the page stays', async () => {
    const { d, factory } = await importing();
    const g = factory();
    await settle();
    askBtn('confirm').click();
    expect(await g.promise).toBe(true);
    await settle();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    d.release({ status: 201, body: mkVersion({ id: 9 }) });
    await settle();
    expect(calls.some((c) => c.key === UP || c.key === BUILD)).toBe(false);
  });

  it('the runner gets a hook that stops further upload attempts once the modal is gone', async () => {
    await toCheck();
    await startImport();
    const hook = vi.mocked(uploadAll).mock.calls[0][7]!;
    expect(hook).toBeTypeOf('function');
    expect(() => hook()).not.toThrow();
    unmount(cmp!);
    cmp = null;
    expect(() => hook()).toThrow();
  });

  it('a confirmed leave stops the import before the next file and never builds', async () => {
    const { d, factory } = await importing();
    const g = factory();
    await settle();
    askBtn('confirm').click();
    expect(await g.promise).toBe(true);
    unmount(cmp!);
    cmp = null;
    routes[UP] = [{ status: 201, body: asset('a.pdf') }, { status: 201, body: asset('b.pdf') }];
    routes[BUILD] = [{ status: 200, body: BUILT }];
    d.release({ status: 201, body: mkVersion({ id: 9 }) });
    await settle();
    expect(calls.some((c) => c.key === UP || c.key === BUILD)).toBe(false);
  });
});

describe('OlxImportModal — leaving between files', () => {
  it('a leave during the uploads sends no further file and never builds', async () => {
    await toCheck();
    const up = deferred();
    await startImport({ [UP]: [up.item, { status: 201, body: asset('b.pdf') }] });
    const factory = vi.mocked(props.registerAsk).mock.calls.at(-1)![0]!;
    const g = factory();
    await settle();
    askBtn('confirm').click();
    expect(await g.promise).toBe(true);
    unmount(cmp!);
    cmp = null;
    up.release({ status: 201, body: asset('a.pdf') });
    await settle();
    expect(calls.filter((c) => c.key === UP).map((c) => c.file)).toEqual(['a.pdf']);
    expect(calls.some((c) => c.key === BUILD)).toBe(false);
  });
});

describe('OlxImportModal — review round 1', () => {
  it('after a list Delete, focus moves to the next row’s Delete (M1)', async () => {
    routes[discardUrl(5)] = [{ status: 204 }];
    await render({ versions: [mkVersion({ id: 4, label: 'Open edX (unfinished): Bio' }), mkVersion({ id: 5, label: 'Open edX (unfinished): Chem' }),
      mkVersion({ id: 8, label: 'Open edX (unfinished): Phys' })] });
    const chem = panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Chem"]')!;
    chem.focus();
    chem.click();
    await settle();
    expect(document.activeElement).toBe(panel().querySelector('button[aria-label="Delete Open edX (unfinished): Phys"]'));
  });

  it('Esc, × and Cancel wait while a Delete is in flight (M2)', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'The import is blocked: x', blockers: [] } }] });
    const d = deferred();
    routes[discardUrl(9)] = [d.item];
    act('delete-draft')!.click();
    await settle();
    expect(panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(act('keep')!.disabled).toBe(true);
    expect(act('retry')).toBeNull();
    d.release({ status: 204 });
    await settle();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc and Cancel wait while a listed draft is being deleted (M2)', async () => {
    const d = deferred();
    routes[discardUrl(5)] = [d.item];
    await render({ versions: [mkVersion({ id: 5, label: 'Open edX (unfinished): Chem' }), mkVersion({ id: 8, label: 'Open edX (unfinished): Phys' })] });
    panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Chem"]')!.click();
    await settle();
    expect(act('cancel')!.disabled).toBe(true);
    expect(panel().querySelector<HTMLButtonElement>('button[aria-label="Delete Open edX (unfinished): Phys"]')!.disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.onClose).not.toHaveBeenCalled();
    d.release({ status: 204 });
    await settle();
    expect(act('cancel')!.disabled).toBe(false);
  });

  it('on open, focus lands on the export file field (M3)', async () => {
    await render();
    expect(document.activeElement).toBe(panel().querySelector('input[data-role="export"]'));
  });

  it('Cancel on the leave question keeps focus in the modal (M4)', async () => {
    await toCheck();
    const d = deferred();
    await startImport({ [DRAFT_URL]: [d.item] });
    const g = vi.mocked(props.registerAsk).mock.calls.at(-1)![0]!();
    await settle();
    askBtn('cancel').click();
    expect(await g.promise).toBe(false);
    await settle();
    expect(document.activeElement).toBe(panel());
  });

  it('after Check, focus is on Import, or on Cancel when the import is blocked (M5)', async () => {
    await toCheck();
    expect(document.activeElement).toBe(act('import'));
    unmount(cmp!);
    cmp = null;
    target.remove();
    await toCheck(checkResponse({ blocking: true, blockers: [{ level: 'skipped', where: '', text: 'x' }] }));
    expect(document.activeElement).toBe(act('cancel'));
  });

  it('the drafts list leaves out disabled, built and other Open edX drafts (M6)', async () => {
    await render({ versions: [
      mkVersion({ id: 5, label: 'Open edX (unfinished): Chem', is_disabled: true }),
      mkVersion({ id: 6, label: 'Open edX: A (2026-11-22)' }),
      mkVersion({ id: 8, label: 'Open edX (unfinished): Phys' }),
    ] });
    expect([...panel().querySelectorAll('.olx-draft-label')].map((e) => e.textContent)).toEqual(['Open edX (unfinished): Phys']);
  });

  it('the export field also accepts .gz for Safari’s picker (S1)', async () => {
    await render();
    expect(panel().querySelector('input[data-role="export"]')!.getAttribute('accept')!.split(',')).toContain('.gz');
  });

  it('reading is busy: × says why, Esc, backdrop and Cancel wait (m4)', async () => {
    let release!: (v: ReturnType<typeof readResult>) => void;
    vi.mocked(readExport).mockReturnValue(new Promise((r) => { release = r; }));
    routes[CHECK_URL] = [{ status: 200, body: checkResponse() }];
    await render();
    pick();
    act('check')!.click();
    await settle();
    const close = panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
    expect(close.disabled).toBe(true);
    expect(close.title).toBe('Wait until the export is checked');
    expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    expect(act('cancel')!.disabled).toBe(true);
    expect(text('.olx-status')).toBe('Reading the export and checking it…');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(props.onClose).not.toHaveBeenCalled();
    release(readResult());
    await settle();
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    document.querySelector<HTMLElement>('.modal-backdrop')!.click();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('the progress line names the step: create, upload N of M, build', async () => {
    await toCheck();
    const draft = deferred();
    const second = deferred();
    const build = deferred();
    await startImport({ [DRAFT_URL]: [draft.item], [UP]: [{ status: 201, body: asset('a.pdf') }, second.item], [BUILD]: [build.item] });
    expect(text('.olx-status')).toBe('Creating the draft…');
    draft.release({ status: 201, body: mkVersion({ id: 9 }) });
    await settle();
    expect(text('.olx-status')).toBe('Uploading files: 1 of 2');
    second.release({ status: 201, body: asset('b.pdf') });
    await settle();
    expect(text('.olx-status')).toBe('Building the course…');
    build.release({ status: 200, body: BUILT });
    await settle();
    expect(act('open-draft')).not.toBeNull();
  });

  it('a running build is not busy and the guard is gone', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 504 }], [STATUS]: [{ status: 200, body: { state: 'running' } }] });
    expect(panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!.disabled).toBe(false);
    expect(props.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(vi.mocked(props.registerAsk).mock.calls.at(-1)![0]).toBeNull();
  });

  it('a failed build unregisters the guard; Retry registers it again', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'blocked', blockers: [] } }] });
    expect(vi.mocked(props.registerAsk).mock.calls.at(-1)![0]).toBeNull();
    unmount(cmp!);
    cmp = null;
    target.remove();
    await toCheck();
    const list = deferred();
    await startImport({
      [UP]: [{ status: 201, body: asset('a.pdf') }, { status: 409, body: { detail: 'exists' } }],
      [LIST]: [{ status: 200, body: [asset('a.pdf'), asset('b.pdf', 7)] }, list.item],
    });
    act('retry')!.click();
    await settle();
    expect(vi.mocked(props.registerAsk).mock.calls.at(-1)![0]).toBeTypeOf('function');
    expect(props.onBusyChange).toHaveBeenLastCalledWith(true);
    list.release({ status: 500, body: { detail: 'Boom' } });
    await settle();
  });

  it('a failed listing on Retry stays Failed with Retry, Keep and Delete and uploads nothing', async () => {
    await toCheck();
    await startImport({
      [UP]: [{ status: 201, body: asset('a.pdf') }, { status: 409, body: { detail: 'exists' } }],
      [LIST]: [{ status: 200, body: [asset('a.pdf'), asset('b.pdf', 7)] }, { status: 500, body: { detail: 'Boom' } }],
    });
    routes[discardUrl(9)] = [{ status: 500, body: { detail: 'Boom' } }];
    act('delete-draft')!.click();
    await settle();
    expect(text('.olx-error')).toBe('Could not delete the draft. Try again.');
    act('retry')!.click();
    await settle();
    expect(text('.olx-failed')).toBe('Could not check which files are already in the draft. Press Retry.');
    expect(panel().querySelector('.olx-error')).toBeNull();
    expect(act('retry')).not.toBeNull();
    expect(act('keep')).not.toBeNull();
    expect(act('delete-draft')).not.toBeNull();
    expect(calls.filter((c) => c.key === UP)).toHaveLength(2);
    expect(vi.mocked(props.registerAsk).mock.calls.at(-1)![0]).toBeNull();
    routes[LIST] = [{ status: 200, body: [asset('a.pdf')] }];
    routes[UP] = [{ status: 201, body: asset('b.pdf') }];
    routes[BUILD] = [{ status: 200, body: BUILT }];
    act('retry')!.click();
    await settle();
    expect(act('open-draft')).not.toBeNull();
  });

  it('Retry and Keep wait while the unfinished draft is being deleted', async () => {
    await toCheck();
    await startImport({
      [UP]: [{ status: 201, body: asset('a.pdf') }, { status: 409, body: { detail: 'exists' } }],
      [LIST]: [{ status: 200, body: [asset('a.pdf'), asset('b.pdf', 7)] }],
    });
    const d = deferred();
    routes[discardUrl(9)] = [d.item];
    act('delete-draft')!.click();
    await settle();
    expect(act('retry')!.disabled).toBe(true);
    expect(act('keep')!.disabled).toBe(true);
    d.release({ status: 204 });
    await settle();
  });

  it('a failed Delete says so; a second Delete clears the sentence while it runs', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'blocked', blockers: [] } }] });
    const d = deferred();
    routes[discardUrl(9)] = [{ status: 500, body: { detail: 'Boom' } }, d.item];
    act('delete-draft')!.click();
    await settle();
    expect(text('.olx-error')).toBe('Could not delete the draft. Try again.');
    act('delete-draft')!.click();
    await settle();
    expect(panel().querySelector('.olx-error')).toBeNull();
    d.release({ status: 204 });
    await settle();
  });

  it('a draft that cannot be created shows Failed with Close only', async () => {
    await toCheck();
    await startImport({ [DRAFT_URL]: [{ status: 403, body: { detail: 'Not allowed.' } }] });
    expect(text('.olx-failed')).toBe('Not allowed.');
    expect(act('delete-draft')).toBeNull();
    expect(act('keep')).toBeNull();
    expect(act('close')).not.toBeNull();
    unmount(cmp!);
    cmp = null;
    target.remove();
    await toCheck();
    await startImport({ [DRAFT_URL]: ['network'] });
    expect(text('.olx-failed')).toBe('Could not reach server. Check your connection.');
  });

  it('double clicks send one request each: Check, Check again, Delete', async () => {
    vi.mocked(readExport).mockResolvedValue(readResult());
    routes[CHECK_URL] = [{ status: 200, body: checkResponse() }];
    await render();
    pick();
    act('check')!.click();
    act('check')!.click();
    await settle();
    expect(vi.mocked(readExport)).toHaveBeenCalledTimes(1);
    const status = deferred();
    await startImport({ [BUILD]: [{ status: 504 }], [STATUS]: [{ status: 200, body: { state: 'running' } }, status.item] });
    act('check-again')!.click();
    act('check-again')!.click();
    status.release({ status: 200, body: { state: 'empty' } });
    await settle();
    expect(calls.filter((c) => c.key === STATUS)).toHaveLength(2);
    const discard = deferred();
    routes[discardUrl(9)] = [discard.item];
    act('delete-draft')!.click();
    act('delete-draft')!.click();
    discard.release({ status: 204 });
    await settle();
    expect(calls.filter((c) => c.key === discardUrl(9))).toHaveLength(1);
  });

  it('app files go to the reader with the export', async () => {
    vi.mocked(readExport).mockResolvedValue(readResult());
    routes[CHECK_URL] = [{ status: 200, body: checkResponse() }];
    await render();
    pick();
    const apps = panel().querySelector<HTMLInputElement>('input[data-role="apps"]')!;
    const sine = new File(['x'], 'sine.js');
    Object.defineProperty(apps, 'files', { value: [sine], configurable: true });
    apps.dispatchEvent(new Event('change', { bubbles: true }));
    act('check')!.click();
    await settle();
    expect(vi.mocked(readExport).mock.calls[0][1]).toEqual([sine]);
  });

  it('a refused check shows the server’s sentence; a new pick or Check clears it', async () => {
    vi.mocked(readExport).mockResolvedValue(readResult());
    routes[CHECK_URL] = [{ status: 422, body: { detail: 'The export is broken.' } }, { status: 422, body: { detail: 'Again.' } }];
    await render();
    pick();
    act('check')!.click();
    await settle();
    expect(text('.olx-error')).toBe('The export is broken.');
    pick('other.tar.gz');
    expect(panel().querySelector('.olx-error')).toBeNull();
    act('check')!.click();
    await settle();
    expect(text('.olx-error')).toBe('Again.');
    let release!: (v: ReturnType<typeof readResult>) => void;
    vi.mocked(readExport).mockReturnValue(new Promise((r) => { release = r; }));
    act('check')!.click();
    await settle();
    expect(panel().querySelector('.olx-error')).toBeNull();
    routes[CHECK_URL] = [{ status: 200, body: checkResponse() }];
    release(readResult());
    await settle();
  });

  it('Check is disabled until an export is picked', async () => {
    await render();
    expect(act('check')!.disabled).toBe(true);
    pick();
    expect(act('check')!.disabled).toBe(false);
  });

  it('limits of 0, a string or a negative number show the limits sentence', async () => {
    for (const bad of [{ max_file_mb: 0 }, { max_total_mb: '200' }, { max_file_mb: -1 }]) {
      routes['GET /api/auth/config'] = [{ status: 200, body: { ...CONFIG, ...bad } }];
      await render();
      expect(text('.olx-error')).toBe("Could not read the site's file limits. Try again.");
      unmount(cmp!);
      cmp = null;
      target.remove();
    }
  });

  it('the summary rounds: 0 bytes in KB, 1.5 MiB in MB', async () => {
    await toCheck(checkResponse({ summary: { ...SUMMARY, bytes: 0 } }));
    expect(text('.olx-summary')).toMatch(/; 2 files, 0 KB$/);
    unmount(cmp!);
    cmp = null;
    target.remove();
    await toCheck(checkResponse({ summary: { ...SUMMARY, bytes: 1.5 * MB } }));
    expect(text('.olx-summary')).toMatch(/; 2 files, 2 MB$/);
  });
});

describe('OlxImportModal — after an unmount nothing answers back', () => {
  function silent() {
    vi.mocked(props.onBusyChange).mockClear();
    vi.mocked(props.registerAsk).mockClear();
    vi.mocked(props.onClose).mockClear();
  }
  function expectSilent() {
    expect(props.onBusyChange).not.toHaveBeenCalled();
    expect(props.registerAsk).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(toasts.list).toHaveLength(0);
  }
  const gone = () => { unmount(cmp!); cmp = null; silent(); };

  it('mid-read: no check is sent', async () => {
    let release!: (v: ReturnType<typeof readResult>) => void;
    vi.mocked(readExport).mockReturnValue(new Promise((r) => { release = r; }));
    await render();
    pick();
    act('check')!.click();
    await settle();
    gone();
    release(readResult());
    await settle();
    expect(calls.some((c) => c.key === CHECK_URL)).toBe(false);
    expectSilent();
  });

  it('mid-check: an answer or a refusal changes nothing', async () => {
    for (const reply of [{ status: 200, body: checkResponse() }, { status: 422, body: { detail: 'No.' } }] as Reply[]) {
      vi.mocked(readExport).mockResolvedValue(readResult());
      const d = deferred();
      routes[CHECK_URL] = [d.item];
      await render();
      pick();
      act('check')!.click();
      await settle();
      gone();
      d.release(reply);
      await settle();
      expectSilent();
      target.remove();
    }
  });

  it('mid-create: a refused draft changes nothing', async () => {
    await toCheck();
    const d = deferred();
    await startImport({ [DRAFT_URL]: [d.item] });
    gone();
    d.release({ status: 403, body: { detail: 'No.' } });
    await settle();
    expectSilent();
  });

  it('mid-upload: a last upload that fails changes nothing', async () => {
    await toCheck();
    const d = deferred();
    await startImport({ [UP]: [{ status: 201, body: asset('a.pdf') }, d.item] });
    gone();
    d.release({ status: 403, body: { detail: 'No.' } });
    await settle();
    expectSilent();
  });

  it('mid-build: the build answer changes nothing', async () => {
    await toCheck();
    const d = deferred();
    await startImport({ [BUILD]: [d.item] });
    gone();
    d.release({ status: 200, body: BUILT });
    await settle();
    expectSilent();
  });

  it('mid-Retry listing: a failed listing changes nothing', async () => {
    await toCheck();
    const d = deferred();
    await startImport({
      [UP]: [{ status: 201, body: asset('a.pdf') }, { status: 409, body: { detail: 'exists' } }],
      [LIST]: [{ status: 200, body: [asset('a.pdf'), asset('b.pdf', 7)] }, d.item],
    });
    act('retry')!.click();
    await settle();
    gone();
    d.release({ status: 500, body: { detail: 'Boom' } });
    await settle();
    expectSilent();
  });

  it('mid-Delete: no toast and no close', async () => {
    await toCheck();
    await startImport({ [BUILD]: [{ status: 409, body: { detail: 'blocked', blockers: [] } }] });
    const d = deferred();
    routes[discardUrl(9)] = [d.item];
    act('delete-draft')!.click();
    await settle();
    gone();
    d.release({ status: 204 });
    await settle();
    expectSilent();
  });
});
