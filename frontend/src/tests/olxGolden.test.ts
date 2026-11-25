// Golden contract of the Open edX import: the reader's body and the server's answers are committed files.
// To update after a change: GOLDEN_UPDATE=1 vitest (body.json), then GOLDEN_UPDATE=1 pytest
// tests/test_olx_golden.py (check.json, build.json), then both again without it. An update run always fails.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readExport } from '../lib/olx/readExport';
import { assembleBuildBody, runBuild, uploadAll, type UploadProgress } from '../lib/olx/run';
import { blobKey, type CheckResponse, type CheckSummary, type ImportLimits, type PlannedUpload, type ReportLine } from '../lib/olx/types';
import { gzip, tar, type TarSpec } from './support/tarWriter';

const MB = 1024 * 1024;
const LIMITS: ImportLimits = { maxFileBytes: 20 * MB, maxTotalBytes: 500 * MB };
const GOLDEN = 'src/tests/fixtures/olx-golden';
const COURSE_DIR = '../backend/tests/fixtures/olx/course';
const APP = '../backend/tests/fixtures/olx/apps/sine-demo.js';
const VID = 7;
const DATE = '2026-11-18';
const fs = () => process.getBuiltinModule('node:fs');

// Every field the import modal reads from the check answer; the type keeps this list complete.
const CHECK_FIELDS: Record<keyof CheckResponse, true> = {
  summary: true, report: true, blockers: true, uploads: true, linked: true, max_quiz_attempts: true, label: true, blocking: true,
};
const SUMMARY_FIELDS: Record<keyof CheckSummary, true> = {
  blocks: true, sequences: true, items: true, videos: true, pages: true, apps: true, quizzes: true, files: true, bytes: true,
};
const LINE_FIELDS: Record<keyof ReportLine, true> = { level: true, where: true, text: true };

type Sent = { url: string; name: string; bytes: Uint8Array };
let sent: Sent[];
let built: unknown[];

class MapFormData {
  private entries = new Map<string, unknown>();
  append(key: string, value: unknown): void {
    this.entries.set(key, value);
  }
  get(key: string): unknown {
    return this.entries.get(key);
  }
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  const { Blob: NodeBlob, File: NodeFile } = process.getBuiltinModule('node:buffer');
  const { DecompressionStream: NodeDS } = process.getBuiltinModule('node:stream/web');
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('DecompressionStream', NodeDS);
  vi.stubGlobal('FormData', MapFormData); // jsdom's FormData rejects Node blobs
  sent = [];
  built = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && init.body instanceof MapFormData) {
      const file = init.body.get('file') as File;
      sent.push({ url, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      return json({ filename: file.name, file_size: file.size }, 201);
    }
    if (init?.method === 'POST' && url === `/api/versions/${VID}/olx-import/build` && typeof init.body === 'string') {
      built.push(JSON.parse(init.body));
      return json(golden('build.json'), 200);
    }
    throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pickedApp(): File {
  return new File([fs().readFileSync(APP)], 'sine-demo.js');
}

function readFixture() {
  const bytes = fs().readFileSync('src/tests/fixtures/olx-course.tar.gz');
  return readExport(new File([bytes], 'course.tar.gz'), [pickedApp()], LIMITS);
}

function golden<T>(name: string): T {
  return JSON.parse(fs().readFileSync(`${GOLDEN}/${name}`, 'utf8')) as T;
}

function emptyProgress(): UploadProgress {
  return { outcome: new Map(), lines: [], uncertain: new Set() };
}

function onDisk(upload: PlannedUpload): Uint8Array {
  return new Uint8Array(fs().readFileSync(upload.kind === 'app' ? APP : `${COURSE_DIR}/static/${upload.source}`));
}

describe('Open edX import golden contract', () => {
  it('reader output equals the committed body', async () => {
    const res = await readFixture();
    if (process.env.GOLDEN_UPDATE === '1') {
      fs().mkdirSync(GOLDEN, { recursive: true });
      fs().writeFileSync(`${GOLDEN}/body.json`, `${JSON.stringify(res.body, null, 2)}\n`);
      throw new Error('body.json rewritten: run the pytest update, then both again without GOLDEN_UPDATE');
    }
    expect(res.body).toEqual(golden('body.json'));
    expect(res.report).toEqual([]);
  });

  it('the check answer has the fields the modal reads', () => {
    const check = golden<CheckResponse>('check.json');
    expect(Object.keys(check).sort()).toEqual(Object.keys(CHECK_FIELDS).sort());
    expect(Object.keys(check.summary).sort()).toEqual(Object.keys(SUMMARY_FIELDS).sort());
    expect(check.blocking).toBe(false);
  });

  it('every report line in the answers has the fields the modal reads', () => {
    const check = golden<CheckResponse>('check.json');
    const lines = [...check.report, ...check.blockers, ...golden<{ report: ReportLine[] }>('build.json').report];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(Object.keys(line).sort()).toEqual(Object.keys(LINE_FIELDS).sort());
  });

  it('uploads follow the golden plan with the files on disk', async () => {
    const res = await readFixture();
    const check = golden<CheckResponse>('check.json');
    const progress = emptyProgress();
    const result = await uploadAll(VID, check.uploads, res.blobs, new Set(check.linked), progress, () => {});
    expect(result).toEqual({ kind: 'done' });
    expect(sent.map((s) => [s.url, s.name])).toEqual(check.uploads.map((u) => [`/api/versions/${VID}/assets`, u.target]));
    check.uploads.forEach((upload, n) => expect(sent[n].bytes).toEqual(onDisk(upload)));
    expect(progress.lines).toEqual([]);
  });

  it('the build body is the golden body, and the golden build answer reads as done', async () => {
    const res = await readFixture();
    const assembled = assembleBuildBody(res.body, res.report, emptyProgress(), DATE);
    expect(assembled).toEqual({ kind: 'ok', body: { ...golden<object>('body.json'), report: [], date: DATE } });
    if (assembled.kind !== 'ok') return;
    const answer = golden<{ report: ReportLine[]; label: string }>('build.json');
    expect(await runBuild(VID, assembled.body)).toEqual({ kind: 'done', report: answer.report, label: answer.label });
    expect(built).toEqual([assembled.body]);
  });

  it('keeps a static file and its app: twin apart from the picked app', async () => {
    const root = COURSE_DIR;
    const entries: TarSpec[] = fs().readdirSync(root, { recursive: true })
      .filter((rel) => fs().statSync(`${root}/${rel}`).isFile())
      .map((rel) => ({ path: `course/${rel}`, data: new Uint8Array(fs().readFileSync(`${root}/${rel}`)) }));
    entries.push({ path: 'course/static/sine-demo.js', data: '// static twin\n' });
    entries.push({ path: 'course/static/app:sine-demo.js', data: '// app: name twin\n' });
    const gz = (await gzip(tar(entries))) as Uint8Array<ArrayBuffer>;
    const res = await readExport(new File([gz], 'course.tar.gz'), [pickedApp()], LIMITS);
    const keys = [blobKey('app', 'sine-demo.js'), blobKey('static', 'sine-demo.js'), blobKey('static', 'app:sine-demo.js')];
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(res.blobs.has(key)).toBe(true);
    const planned = golden<CheckResponse>('check.json').uploads.filter((u) => u.kind === 'app');
    expect(planned).toHaveLength(1);
    const result = await uploadAll(VID, planned, res.blobs, new Set(), emptyProgress(), () => {});
    expect(result).toEqual({ kind: 'done' });
    expect(sent).toHaveLength(1);
    expect(sent[0].bytes).toEqual(onDisk(planned[0]));
  });
});
