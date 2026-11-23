import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILD_CAPS, REFUSAL, assembleBuildBody, buildStatus, checkImport, createDraft, discardDraft, localDate, markPresent,
  checkBuildSize, reportText, runBuild, uploadAll, type UploadProgress,
} from '../lib/olx/run';
import { blobKey, type CheckBody, type PlannedUpload, type ReportLine } from '../lib/olx/types';

type Reply = { status: number; body?: unknown } | 'network';
type Call = { key: string; file?: string; body?: unknown };

const VID = 7;
const ASSETS = `/api/versions/${VID}/assets`;
const UP = `POST ${ASSETS}`;
const LIST = `GET ${ASSETS}`;
const MB = 1024 * 1024;

let routes: Record<string, Reply[]>;
let calls: Call[];

function respond(r: Reply): Response {
  if (r === 'network') throw new TypeError('Failed to fetch');
  if (r.status === 204) return new Response(null, { status: 204 });
  return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const call: Call = { key };
    if (init?.body instanceof FormData) call.file = (init.body.get('file') as File).name;
    else if (typeof init?.body === 'string') call.body = JSON.parse(init.body);
    calls.push(call);
    const queue = routes[key];
    if (!queue || queue.length === 0) throw new Error(`unexpected fetch ${key}`);
    return respond(queue.shift()!);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const asset = (filename: string, file_size: number) => ({
  id: 1, version_id: VID, filename, file_size, mime_type: 'application/pdf', uploaded_at: '', uploaded_by: 1, is_referenced: false,
});
const ok = (filename: string, size = 1): Reply => ({ status: 201, body: asset(filename, size) });
const err = (status: number, detail = 'Nope'): Reply => ({ status, body: { detail } });

function textBlob(text: string): Blob {
  return Object.assign(new Blob([text]), { text: async () => text }); // jsdom's Blob has no text()
}

const st = (source: string, target = source, size = 1): PlannedUpload => ({ source, target, kind: 'static', size });
const app = (name: string, size = 1): PlannedUpload => ({ source: name, target: name, kind: 'app', size });

function blobsFor(plan: PlannedUpload[], appSource = 'mount("app-root")'): Map<string, Blob> {
  return new Map(plan.map((u) => [blobKey(u.kind, u.source), u.kind === 'app' ? textBlob(appSource) : new Blob(['x'])]));
}

const fresh = (): UploadProgress => ({ outcome: new Map(), lines: [], uncertain: new Set() });
const noWait = () => {
  const waits: number[] = [];
  return { waits, wait: async (ms: number) => { waits.push(ms); } };
};
const uploads = () => calls.filter((c) => c.key === UP).map((c) => c.file);

describe('uploadAll', () => {
  it('uploads in order and reports progress', async () => {
    const plan = [st('img/a.png', 'a.png'), st('notes.pdf'), app('sine.js')];
    routes[UP] = [ok('a.png'), ok('notes.pdf'), ok('sine.js')];
    const seen: [number, number][] = [];
    const progress = fresh();
    const res = await uploadAll(VID, plan, blobsFor(plan), new Set(), progress, (d, t) => seen.push([d, t]), noWait().wait);
    expect(res).toEqual({ kind: 'done' });
    expect(uploads()).toEqual(['a.png', 'notes.pdf', 'sine.js']);
    expect(seen).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    expect([...progress.outcome]).toEqual([['a.png', 'done'], ['notes.pdf', 'done'], ['sine.js', 'done']]);
  });

  it('makes at most 3 attempts on network errors, 5xx and 429, then returns retry', async () => {
    const plan = [st('a.pdf'), st('b.pdf')];
    routes[UP] = ['network', err(503), err(429, 'Slow down')];
    const w = noWait();
    const res = await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, w.wait);
    expect(res.kind).toBe('retry');
    expect(res).toEqual({ kind: 'retry', message: 'The file “a.pdf” could not be uploaded after 3 tries: Slow down. Press Retry to go on.' });
    expect(w.waits).toEqual([1000, 2000]);
    expect(uploads()).toEqual(['a.pdf', 'a.pdf', 'a.pdf']);
    routes[UP] = [err(500), ok('a.pdf'), ok('b.pdf')];
    const again = noWait();
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, again.wait)).toEqual({ kind: 'done' });
    expect(again.waits).toEqual([1000]);
  });

  it('three network errors say the offline sentence; a 5xx with its own sentence keeps it', async () => {
    routes[UP] = ['network', 'network', 'network'];
    const res = await uploadAll(VID, [st('a.pdf')], blobsFor([st('a.pdf')]), new Set(), fresh(), () => {}, noWait().wait);
    expect(res).toEqual({ kind: 'retry',
      message: 'The file “a.pdf” could not be uploaded after 3 tries: Could not reach server. Check your connection. Press Retry to go on.' });
    routes[UP] = [err(503, 'Down.'), err(503, 'Down.'), err(503, 'Down.')];
    const down = await uploadAll(VID, [st('a.pdf')], blobsFor([st('a.pdf')]), new Set(), fresh(), () => {}, noWait().wait);
    expect(down).toEqual({ kind: 'retry', message: 'The file “a.pdf” could not be uploaded after 3 tries: Down. Press Retry to go on.' });
    routes[UP] = [{ status: 500, body: {} }, { status: 502, body: {} }, { status: 500, body: {} }];
    const bare = await uploadAll(VID, [st('a.pdf')], blobsFor([st('a.pdf')]), new Set(), fresh(), () => {}, noWait().wait);
    expect(bare).toEqual({ kind: 'retry',   // never "Try again." next to "Press Retry"
      message: 'The file “a.pdf” could not be uploaded after 3 tries: Something went wrong on the server. Press Retry to go on.' });
    routes[UP] = [{ status: 429, body: {} }, { status: 429, body: {} }, { status: 429, body: {} }];
    const busy = await uploadAll(VID, [st('a.pdf')], blobsFor([st('a.pdf')]), new Set(), fresh(), () => {}, noWait().wait);
    expect(busy).toEqual({ kind: 'retry',
      message: 'The file “a.pdf” could not be uploaded after 3 tries: Something went wrong. Press Retry to go on.' });
  });

  it('beforeAttempt runs before every attempt, outside the retry catch, and its throw stops the uploads', async () => {
    routes[UP] = [err(503), ok('a.pdf')];
    let left = false;
    const seen: number[] = [];
    const wait = async () => { left = true; };
    const beforeAttempt = () => { seen.push(calls.length); if (left) throw new Error('left'); };
    await expect(uploadAll(VID, [st('a.pdf')], blobsFor([st('a.pdf')]), new Set(), fresh(), () => {}, wait, beforeAttempt))
      .rejects.toThrow('left');
    expect(uploads()).toEqual(['a.pdf']);
    expect(seen).toEqual([0, 1]);
  });

  it('keeps refusals and warnings across retry → markPresent → resume, each reported once', async () => {
    const plan = [app('x.js', 3), st('u.pdf'), st('b.png')];
    const blobs = blobsFor(plan, 'fetch("https://cdn")');
    const progress = fresh();
    routes[UP] = [ok('x.js', 3), err(415, 'Bad type'), 'network', 'network', 'network'];
    expect((await uploadAll(VID, plan, blobs, new Set(), progress, () => {}, noWait().wait)).kind).toBe('retry');
    routes[LIST] = [{ status: 200, body: [asset('x.js', 3)] }];
    await markPresent(VID, plan, progress);
    routes[UP] = [ok('b.png')];
    calls = [];
    expect(await uploadAll(VID, plan, blobs, new Set(), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect(uploads()).toEqual(['b.png']);
    const texts = progress.lines.map((l) => l.text);
    expect(texts.filter((t) => t.startsWith('x.js: '))).toHaveLength(2);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.filter((t) => t.includes('“u.pdf”'))).toHaveLength(1);
  });

  it('409 with matching size is done; with other size is retry', async () => {
    const plan = [st('a.pdf', 'a.pdf', 5)];
    routes[UP] = [err(409, 'exists')];
    routes[LIST] = [{ status: 200, body: [asset('a.pdf', 5)] }];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait)).toEqual({ kind: 'done' });
    routes[UP] = [err(409, 'exists')];
    routes[LIST] = [{ status: 200, body: [asset('a.pdf', 6)] }];
    const res = await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait);
    expect(res.kind).toBe('retry');
    routes[UP] = [err(409, 'exists')];
    routes[LIST] = ['network'];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'retry', message: 'Could not check whether “a.pdf” is already in the draft. Press Retry.' });
    routes[UP] = [err(409, 'exists')];
    routes[LIST] = [{ status: 200, body: [asset('other.pdf', 5)] }];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'retry', message: 'A different file named “a.pdf” is already in the draft. Press Retry to check again.' });
  });

  it('refusal of an unlinked file becomes a report line and continues', async () => {
    const plan = [st('docs/u.pdf', 'u.pdf'), st('b.pdf')];
    routes[UP] = [err(422, 'File is empty'), ok('b.pdf')];
    const progress = fresh();
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(['b.pdf']), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect(progress.outcome.get('u.pdf')).toBe('refused');
    expect(progress.lines).toEqual([{
      level: 'skipped', where: '',
      text: 'The file “docs/u.pdf” was refused by the server (File is empty), so it was not uploaded; upload it by hand if a page needs it',
    }]);
    expect([...REFUSAL].sort()).toEqual([400, 413, 415, 422]);
    for (const status of [400, 413, 415, 422]) {
      routes[UP] = [err(status), ok('b.pdf')];
      expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait)).toEqual({ kind: 'done' });
    }
  });

  it('refusal of a linked or app file fails at once', async () => {
    const plan = [st('a.pdf'), st('b.pdf')];
    routes[UP] = [err(413, 'Too big')];
    const res = await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait);
    expect(res).toEqual({ kind: 'failed', message: 'The file “a.pdf” could not be uploaded: Too big' });
    expect(uploads()).toEqual(['a.pdf']);
    const moved = [st('dir/a.png', 'a.png')];
    routes[UP] = [err(400, 'Bad')];
    expect((await uploadAll(VID, moved, blobsFor(moved), new Set(['a.png']), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
    const apps = [app('s.js'), st('b.pdf')];
    routes[UP] = [err(400, 'Bad')];
    expect((await uploadAll(VID, apps, blobsFor(apps), new Set(), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
  });

  it('refusal lines name a plain reason when the server gives none', async () => {
    const plan = [st('a.pdf'), st('b.pdf'), st('c.pdf')];
    routes[UP] = [{ status: 422, body: { detail: [{ loc: ['file'], msg: 'x', type: 'y' }] } }, { status: 413, body: '<html>' }, err(415, 'Type .exe is not allowed.')];
    const progress = fresh();
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect(progress.lines.map((l) => l.text.replace(/^The file “.*?” was refused by the server \((.*)\).*$/, '$1'))).toEqual([
      'the file was not accepted', 'the file is too large for the server', 'Type .exe is not allowed',
    ]);
  });

  it('fails when the server stores the file under another name', async () => {
    const plan = [st('s.png')];
    routes[UP] = [ok('other-name.png')];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'failed', message: 'The file “s.png” was stored as “other-name.png”, so links to it would break.' });
  });

  it('fails plainly when an app file cannot be read', async () => {
    const plan = [app('m.js')];
    const broken = Object.assign(new Blob(['x']), { text: async () => { throw new DOMException('gone', 'NotReadableError'); } });
    expect(await uploadAll(VID, plan, new Map([[blobKey('app', 'm.js'), broken]]), new Set(), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'failed', message: 'The app file “m.js” could not be read. Pick it again.' });
    expect(uploads()).toEqual([]);
  });

  it('401/403/404 fail at once', async () => {
    for (const status of [401, 403, 404]) {
      calls = [];
      const plan = [st('a.pdf'), st('b.pdf')];
      routes[UP] = [err(status)];
      expect((await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
      expect(uploads()).toEqual(['a.pdf']);
    }
  });

  it('app files get scanAppSource warnings as note lines, never blocking', async () => {
    const plan: PlannedUpload[] = [{ source: 'M.js', target: 'm.js', kind: 'app', size: 1 }];
    routes[UP] = [ok('m.js')];
    const progress = fresh();
    const res = await uploadAll(VID, plan, blobsFor(plan, 'export default 1'), new Set(), progress, () => {}, noWait().wait);
    expect(res).toEqual({ kind: 'done' });
    expect(progress.lines).toEqual([
      { level: 'note', where: '', text: 'm.js: Looks like an ES module — must be a single classic/IIFE bundle.' },
      { level: 'note', where: '', text: "m.js: Doesn't reference #app-root — make sure your app mounts into it." },
    ]);
  });

  it('a 400 after a network-error retry re-lists and counts a present file as done', async () => {
    const plan = [st('a.pdf', 'a.pdf', 4)];
    routes[UP] = ['network', err(400, 'exists?')];
    routes[LIST] = [{ status: 200, body: [asset('a.pdf', 4)] }];
    const progress = fresh();
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect(progress.outcome.get('a.pdf')).toBe('done');
    routes[UP] = ['network', err(400, 'Bad')];
    routes[LIST] = [{ status: 200, body: [] }];
    expect((await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
    routes[UP] = [err(400, 'Bad')];
    expect((await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
    expect(calls.filter((c) => c.key === LIST)).toHaveLength(2);
    routes[UP] = ['network', err(400, 'Bad')];
    routes[LIST] = ['network'];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'retry', message: 'Could not check whether “a.pdf” is already in the draft. Press Retry.' });
    const unlinked = fresh();
    routes[UP] = [err(503), err(400, 'Over the total')];
    routes[LIST] = [err(503)];
    expect((await uploadAll(VID, plan, blobsFor(plan), new Set(), unlinked, () => {}, noWait().wait)).kind).toBe('retry');
    expect(unlinked).toEqual({ outcome: new Map(), lines: [], uncertain: new Set(['a.pdf']) });
    routes[UP] = ['network', err(403, 'Version is disabled')];
    routes[LIST] = ['network'];
    expect((await uploadAll(VID, plan, blobsFor(plan), new Set(), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
  });

  it('markPresent marks listed files with matching size as done; resume skips done and refused', async () => {
    const plan = [st('a.png', 'a.png', 2), st('b.png', 'b.png', 2), st('u.pdf')];
    const progress: UploadProgress = { outcome: new Map([['u.pdf', 'refused']]), lines: [], uncertain: new Set() };
    routes[LIST] = [{ status: 200, body: [asset('a.png', 2), asset('b.png', 3), asset('u.pdf', 1)] }];
    await markPresent(VID, plan, progress);
    expect([...progress.outcome]).toEqual([['u.pdf', 'refused'], ['a.png', 'done']]);
    routes[UP] = [ok('b.png', 2)];
    const seen: [number, number][] = [];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), progress, (d, t) => seen.push([d, t]), noWait().wait)).toEqual({ kind: 'done' });
    expect(uploads()).toEqual(['b.png']);
    expect(seen).toEqual([[2, 3], [3, 3]]);
  });

  it('warnings of an app file retried after network errors are reported once', async () => {
    const plan = [app('m.js')];
    const blobs = blobsFor(plan, 'no root');
    const progress = fresh();
    routes[UP] = ['network', 'network', 'network'];
    expect((await uploadAll(VID, plan, blobs, new Set(), progress, () => {}, noWait().wait)).kind).toBe('retry');
    routes[UP] = [ok('m.js')];
    expect(await uploadAll(VID, plan, blobs, new Set(), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect(progress.lines.map((l) => l.text)).toEqual(["m.js: Doesn't reference #app-root — make sure your app mounts into it."]);
  });

  it('a planned file without a blob fails', async () => {
    const plan = [st('a.pdf')];
    expect(await uploadAll(VID, plan, new Map(), new Set(), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'failed', message: 'The file “a.pdf” was not found in the export.' });
    expect(uploads()).toEqual([]);
  });

  it('remembers across Retry that an earlier attempt may have stored the file', async () => {
    const plan = [st('docs/a.pdf', 'a.pdf', 4)];
    const progress = fresh();
    routes[UP] = ['network', err(400, 'Over the total')];
    routes[LIST] = ['network'];
    expect((await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), progress, () => {}, noWait().wait)).kind).toBe('retry');
    routes[LIST] = ['network'];
    await expect(markPresent(VID, plan, progress)).rejects.toThrow();
    routes[UP] = [err(400, 'Over the total')];
    routes[LIST] = [{ status: 200, body: [asset('a.pdf', 4)] }];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect(progress.outcome.get('a.pdf')).toBe('done');
  });

  it('remembers uncertainty per file, not for the whole run', async () => {
    const plan = [st('a.pdf'), st('b.pdf')];
    const progress = fresh();
    routes[UP] = ['network', ok('a.pdf'), err(400, 'Bad')];
    routes[LIST] = ['network'];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(), progress, () => {}, noWait().wait)).toEqual({ kind: 'done' });
    expect([...progress.outcome]).toEqual([['a.pdf', 'done'], ['b.pdf', 'refused']]);
    expect(calls.filter((c) => c.key === LIST)).toHaveLength(0);
  });

  it('re-lists after a 5xx but not after a 429 before a 4xx', async () => {
    const plan = [st('a.pdf', 'a.pdf', 4)];
    routes[UP] = [err(502), err(400)];
    routes[LIST] = [{ status: 200, body: [asset('a.pdf', 4)] }];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait)).toEqual({ kind: 'done' });
    calls = [];
    routes[UP] = [err(429), err(400)];
    expect((await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait)).kind).toBe('failed');
    expect(calls.filter((c) => c.key === LIST)).toHaveLength(0);
    routes[UP] = ['network', err(429), err(400)];
    routes[LIST] = [{ status: 200, body: [asset('a.pdf', 4)] }];
    expect(await uploadAll(VID, plan, blobsFor(plan), new Set(['a.pdf']), fresh(), () => {}, noWait().wait)).toEqual({ kind: 'done' });
  });

  it('check → upload: a refused file in check.linked fails, one not in it continues', async () => {
    const body: CheckBody = { files: { 'course.xml': '<course/>' }, static: [], apps: [] };
    routes['POST /api/courses/3/olx-import/check'] = [{ status: 200, body: {
      summary: {}, report: [], blockers: [], linked: ['a.pdf'], max_quiz_attempts: 3, label: 'Open edX (unfinished): C', blocking: false,
      uploads: [st('a.pdf'), st('b.pdf')],
    } }];
    const check = await checkImport(3, body);
    expect(calls[0].body).toEqual(body);
    routes[UP] = [ok('a.pdf'), err(415)];
    expect(await uploadAll(VID, check.uploads, blobsFor(check.uploads), new Set(check.linked), fresh(), () => {}, noWait().wait))
      .toEqual({ kind: 'done' });
    routes[UP] = [err(415)];
    expect((await uploadAll(VID, check.uploads, blobsFor(check.uploads), new Set(check.linked), fresh(), () => {}, noWait().wait)).kind)
      .toBe('failed');
  });
});

describe('drafts and builds', () => {
  const BUILD = `POST /api/versions/${VID}/olx-import/build`;
  const STATUS = `GET /api/versions/${VID}/olx-import/status`;
  const DISCARD = `POST /api/versions/${VID}/olx-import/discard`;
  const buildBody = { files: {}, static: [], apps: [], report: [], date: '2026-11-22' };

  it('createDraft posts the label and attempts with empty info', async () => {
    routes['POST /api/courses/3/versions'] = [{ status: 201, body: { id: 9 } }];
    expect((await createDraft(3, 'Open edX (unfinished): C', 4)).id).toBe(9);
    expect(calls[0].body).toEqual({ info_md: '', max_quiz_attempts: 4, label: 'Open edX (unfinished): C' });
  });

  it('checkBuildSize flags a report the build could never take, before any draft exists', () => {
    const body: CheckBody = { files: { 'course.xml': '<course/>' }, static: [], apps: [] };
    expect(checkBuildSize(body, [])).toBeNull();
    const many: ReportLine[] = Array.from({ length: 20001 }, () => ({ level: 'note', where: '', text: 'x' }));
    expect(checkBuildSize(body, many)).toBe("This export's report is too large to import. Import fewer files.");
  });

  it('runBuild on a blocked 409 names the blockers, up to three', async () => {
    const b = (t: string) => ({ level: 'skipped', where: 'Unit 1', text: t });
    routes[BUILD] = [{ status: 409, body: { detail: 'The import is blocked: a', blockers: [b('a'), b('b'), b('c'), b('d'), b('e')] } },
      { status: 409, body: { detail: 'The import is blocked: a', blockers: [{ level: 'skipped', where: '', text: 'a' }] } }];
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', canDiscard: true,
      message: 'The import is blocked: Unit 1: a; Unit 1: b; Unit 1: c; and 2 more.' });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', canDiscard: true, message: 'The import is blocked: a.' });
  });

  it('runBuild returns done with the report', async () => {
    const report = [{ level: 'note', where: '', text: 'hi' }];
    routes[BUILD] = [{ status: 200, body: { report, label: 'Open edX: C (2026-11-22)' } }];
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'done', report, label: 'Open edX: C (2026-11-22)' });
    expect(calls[0].body).toEqual(buildBody);
  });

  it('runBuild on 504 or network error asks status: running, built → committed-unknown, empty → failed', async () => {
    routes[BUILD] = [err(504), 'network', err(502), err(503), err(524), err(500)];
    routes[STATUS] = [{ status: 200, body: { state: 'running' } }, { status: 200, body: { state: 'built' } },
      { status: 200, body: { state: 'empty' } }];
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'running' });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'committed-unknown' });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', message: 'The import did not finish, and nothing was built.', canDiscard: true });
    routes[STATUS] = [{ status: 200, body: { state: 'running' } }, { status: 200, body: { state: 'built' } }, { status: 200, body: { state: 'empty' } }];
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'running' });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'committed-unknown' });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', message: 'The import did not finish, and nothing was built.', canDiscard: true });
  });

  it('a build answer without a report counts as committed with the report unknown', async () => {
    routes[BUILD] = [{ status: 200, body: {} }, { status: 200, body: { report: 'x', label: 5 } }, { status: 200, body: { report: [], label: 7 } },
      { status: 200, body: { report: 'x', label: 'L' } }];
    for (let i = 0; i < 4; i++) expect(await runBuild(VID, buildBody)).toEqual({ kind: 'committed-unknown' });
  });

  it('a failed status call stays running', async () => {
    routes[STATUS] = [err(500), 'network', err(429), err(401), { status: 200, body: { state: 'weird' } }, { status: 200, body: {} }];
    for (let i = 0; i < 6; i++) expect(await buildStatus(VID)).toEqual({ kind: 'running' });
    routes[STATUS] = [err(403, 'Version is disabled')];
    expect(await buildStatus(VID)).toEqual({ kind: 'failed', message: 'Version is disabled', canDiscard: false });
    routes[STATUS] = [err(404, 'Version not found')];
    expect(await buildStatus(VID)).toMatchObject({ kind: 'failed', canDiscard: false });
  });

  it('a build 404 or 403 gives failed with canDiscard false; a 409 gives canDiscard true', async () => {
    routes[BUILD] = [err(404, 'Version not found'), { status: 409, body: { detail: 'The import is blocked: x', blockers: [] } }, err(403, 'Version is disabled'), err(422, 'Bad body')];
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', message: 'Version not found', canDiscard: false });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', message: 'The import is blocked: x', canDiscard: true });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', message: 'Version is disabled', canDiscard: false });
    expect(await runBuild(VID, buildBody)).toEqual({ kind: 'failed', message: 'Bad body', canDiscard: true });
  });

  it('discardDraft maps 204, 409 and other statuses', async () => {
    routes[DISCARD] = [{ status: 204 }, err(409), err(500), err(403), 'network', err(404)];
    expect(await discardDraft(VID)).toBe('deleted');
    expect(await discardDraft(VID)).toBe('built');
    expect(await discardDraft(VID)).toBe('failed');
    expect(await discardDraft(VID)).toBe('failed');
    expect(await discardDraft(VID)).toBe('failed');
    expect(await discardDraft(VID)).toBe('deleted');
  });
});

describe('report and body', () => {
  it('localDate uses local time', () => {
    expect(localDate(new Date('2026-11-22T23:30:00Z'))).toBe('2026-11-23');
    expect(localDate(new Date('2026-03-05T10:00:00Z'))).toBe('2026-03-05');
    expect(localDate(new Date('2025-12-31T23:30:00Z'))).toBe('2026-01-01');
    expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reportText groups blockers, skipped, changed, note', () => {
    const lines: ReportLine[] = [
      { level: 'note', where: '', text: 'n1' },
      { level: 'changed', where: 'B › S › U', text: 'c1' },
      { level: 'skipped', where: 'B › S', text: 's1' },
      { level: 'note', where: 'B', text: 'n2' },
    ];
    expect(reportText(lines, [{ level: 'skipped', where: '', text: 'stop' }])).toBe(
      'Problems that stop the import\n- stop\n\nSkipped\n- B › S: s1\n\nChanged\n- B › S › U: c1\n\nNotes\n- n1\n- B: n2\n',
    );
    expect(reportText([{ level: 'note', where: '', text: 'only' }], [])).toBe('Notes\n- only\n');
    expect(reportText([], [])).toBe('Nothing to report.\n');
  });

  const check: CheckBody = { files: { 'course.xml': '<course/>' }, static: [], apps: [] };

  it('assembleBuildBody merges reader and upload lines and cuts long where/text', () => {
    const reader: ReportLine[] = [{ level: 'skipped', where: '', text: 'reader' }];
    const progress: UploadProgress = { outcome: new Map(), lines: [
      { level: 'note', where: 'w'.repeat(700), text: '😀'.repeat(2100) },
      { level: 'changed', where: '', text: 'a\0b\0c' },
    ], uncertain: new Set() };
    const res = assembleBuildBody(check, reader, progress, '2026-11-22');
    expect(res.kind).toBe('ok');
    const body = (res as { body: { report: ReportLine[]; date: string; files: unknown } }).body;
    expect(body.date).toBe('2026-11-22');
    expect(body.files).toEqual(check.files);
    expect(body.report.map((l) => [l.level, l.text.slice(0, 6)])).toEqual([['skipped', 'reader'], ['note', '😀😀😀'], ['changed', 'a?b?c']]);
    expect(BUILD_CAPS).toEqual({ bytes: 40 * MB, lines: 20000, where: 600, text: 2000 });
    const cut = body.report[1];
    expect([...cut.where]).toHaveLength(600);
    expect(cut.where.endsWith('…')).toBe(true);
    expect([...cut.text]).toHaveLength(2000);
    expect(cut.text.endsWith('😀…')).toBe(true);
    expect(progress.lines[0].where).toHaveLength(700);
    const exact = { level: 'note' as const, where: 'w'.repeat(BUILD_CAPS.where), text: 't'.repeat(BUILD_CAPS.text) };
    const kept = assembleBuildBody(check, [exact], { outcome: new Map(), lines: [], uncertain: new Set() }, 'd');
    expect((kept as { body: { report: ReportLine[] } }).body.report).toEqual([exact]);
  });

  it('assembleBuildBody: a check body under 40 MB that passes 40 MB with its report gives too-large', () => {
    const big: CheckBody = { files: { 'a.xml': 'x'.repeat(40 * MB - 500) }, static: [], apps: [] };
    expect(assembleBuildBody(big, [], { outcome: new Map(), lines: [], uncertain: new Set() }, '2026-11-22').kind).toBe('ok');
    const lines = Array.from({ length: 10 }, (_, i) => ({ level: 'note' as const, where: '', text: `line ${i} ${'y'.repeat(100)}` }));
    const res = assembleBuildBody(big, lines, { outcome: new Map(), lines: [], uncertain: new Set() }, '2026-11-22');
    expect(res).toEqual({ kind: 'too-large', message: "This export's report is too large to build. Delete the draft and import fewer files." });
  });

  it('assembleBuildBody measures UTF-8 bytes and allows exactly 40 MB', () => {
    const none: UploadProgress = { outcome: new Map(), lines: [], uncertain: new Set() };
    const overhead = new TextEncoder().encode(JSON.stringify({ files: { 'a.xml': '' }, static: [], apps: [], report: [], date: 'd' })).length;
    const exact: CheckBody = { files: { 'a.xml': 'x'.repeat(40 * MB - overhead) }, static: [], apps: [] };
    expect(assembleBuildBody(exact, [], none, 'd').kind).toBe('ok');
    const over: CheckBody = { files: { 'a.xml': 'x'.repeat(40 * MB - overhead + 1) }, static: [], apps: [] };
    expect(assembleBuildBody(over, [], none, 'd').kind).toBe('too-large');
    const wide: CheckBody = { files: { 'a.xml': 'é'.repeat(21 * MB) }, static: [], apps: [] };
    expect(assembleBuildBody(wide, [], none, 'd').kind).toBe('too-large');
  });

  it('assembleBuildBody: 20 001 lines gives too-large', () => {
    const line = (i: number): ReportLine => ({ level: 'note', where: '', text: `l${i}` });
    const reader = Array.from({ length: 19_999 }, (_, i) => line(i));
    expect(assembleBuildBody(check, reader, { outcome: new Map(), lines: [line(-1)], uncertain: new Set() }, 'd').kind).toBe('ok');
    expect(assembleBuildBody(check, reader, { outcome: new Map(), lines: [line(-1), line(-2)], uncertain: new Set() }, 'd').kind).toBe('too-large');
  });
});
