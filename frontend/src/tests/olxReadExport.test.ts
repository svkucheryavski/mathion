import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_EXTENSIONS, READ_CAPS, ReadError, readExport, type ReadCaps } from '../lib/olx/readExport';
import type { ArchiveSource, ImportLimits } from '../lib/olx/types';
import { gzip, rechecksum, tar, type TarSpec } from './support/tarWriter';

const MB = 1024 * 1024;
const LIMITS: ImportLimits = { maxFileBytes: 20 * MB, maxTotalBytes: 500 * MB };
const fs = () => process.getBuiltinModule('node:fs');

beforeEach(() => {
  const { Blob: NodeBlob, File: NodeFile } = process.getBuiltinModule('node:buffer');
  const { DecompressionStream: NodeDS } = process.getBuiltinModule('node:stream/web');
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('DecompressionStream', NodeDS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function file(bytes: Uint8Array, name = 'course.tar.gz'): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name);
}

function course(extra: TarSpec[] = [], root = 'c'): TarSpec[] {
  return [{ path: `${root}/course.xml`, data: '<course url_name="r"/>' }, ...extra];
}

async function read(entries: TarSpec[], opts: { limits?: ImportLimits; caps?: Partial<ReadCaps>; apps?: File[]; gz?: boolean } = {}) {
  const raw = tar(entries);
  const bytes = opts.gz === false ? raw : await gzip(raw);
  return readExport(file(bytes), opts.apps ?? [], opts.limits ?? LIMITS, { ...READ_CAPS, ...opts.caps });
}

describe('readExport', () => {
  it('reads the committed fixture tar: course root, text files, static entries', async () => {
    const bytes = fs().readFileSync('src/tests/fixtures/olx-course.tar.gz');
    const app = new File([fs().readFileSync('../backend/tests/fixtures/olx/apps/sine-demo.js')], 'sine-demo.js');
    const res = await readExport(file(bytes), [app], LIMITS);
    const keys = Object.keys(res.body.files).sort();
    expect(keys).toContain('course.xml');
    expect(keys).toContain('policies/2026_T1/policy.json');
    expect(keys).toContain('html/h_welcome.html');
    expect(keys.some((k) => k.startsWith('about/') || k.startsWith('static/'))).toBe(false);
    expect(keys).toHaveLength(39);
    expect(res.body.files['course.xml']).toBe(fs().readFileSync('../backend/tests/fixtures/olx/course/course.xml', 'utf8'));
    expect(res.body.static).toEqual([
      { path: 'img/fig 1.png', size: 67, skipped: null },
      { path: 'notes.pdf', size: 586, skipped: null },
    ]);
    expect(res.body.apps).toEqual([{ name: 'sine-demo.js', size: 409 }]);
    expect([...res.blobs.keys()].sort()).toEqual(['app:sine-demo.js', 'img/fig 1.png', 'notes.pdf']);
    expect(res.blobs.get('img/fig 1.png')!.size).toBe(67);
    expect(new Uint8Array(await res.blobs.get('notes.pdf')!.arrayBuffer())).toEqual(
      new Uint8Array(fs().readFileSync('../backend/tests/fixtures/olx/course/static/notes.pdf')),
    );
    expect(res.report).toEqual([]);
    expect(res.jsonBytes).toBe(new TextEncoder().encode(JSON.stringify(res.body)).length);
  });

  it('handles ustar prefix, GNU long names, pax path/size and base-256 sizes', async () => {
    const long = 'n'.repeat(120) + '.xml';
    const res = await read(course([
      { path: 'h.html', prefix: 'c/html', data: '<p>prefix</p>' },
      { path: `c/vertical/${long}`, longName: true, data: '<vertical/>' },
      { path: 'x', pax: { path: 'c/static/pax ü.png', size: '5' }, size: 0, data: 'PNG!!' },
      { path: 'c/static/b.pdf', base256: true, data: '%PDF-1' },
    ]));
    expect(res.body.files['html/h.html']).toBe('<p>prefix</p>');
    expect(res.body.files[`vertical/${long}`]).toBe('<vertical/>');
    expect(res.body.static).toEqual([
      { path: 'b.pdf', size: 6, skipped: null },
      { path: 'pax ü.png', size: 5, skipped: null },
    ]);
  });

  it('skips directories and links; truncated archive throws', async () => {
    const res = await read(course([
      { path: 'c/html/', type: '5' },
      { path: 'c/html/l.html', type: '2', linkname: 'x.html' },
      { path: 'c/static/l.png', type: '1', linkname: 'x.png' },
    ]));
    expect(Object.keys(res.body.files)).toEqual(['course.xml']);
    expect(res.body.static).toEqual([]);
    const full = await gzip(tar(course([{ path: 'c/html/a.html', data: 'x'.repeat(5000) }])));
    const cut = tar(course([{ path: 'c/html/a.html', data: 'x'.repeat(5000) }])).slice(0, 2000);
    await expect(readExport(file(cut, 'c.tar'), [], LIMITS)).rejects.toThrow('ends too early');
    await expect(readExport(file(full.slice(0, full.length - 20)), [], LIMITS)).rejects.toThrow(ReadError);
  });

  it('rejects .. entries and normalises backslashes', async () => {
    const res = await read([
      { path: 'c\\course.xml', data: '<course/>' },
      { path: '/c/html\\a.html', data: 'a' },
      { path: './c/./html/b.html', data: 'b' },
      { path: 'c/../evil.xml', data: 'no' },
      { path: 'c/html/../../evil2.xml', data: 'no' },
      { path: 'c/static\\img\\p.png', data: 'png' },
    ]);
    expect(Object.keys(res.body.files).sort()).toEqual(['course.xml', 'html/a.html', 'html/b.html']);
    expect(res.body.static).toEqual([{ path: 'img/p.png', size: 3, skipped: null }]);
    expect(res.report.filter((l) => l.text.includes('..'))).toHaveLength(1);
    expect(res.report[0].text).toContain('2 entries');
    const one = await read(course([{ path: 'x', pax: { path: 'c/html/n\0.html' }, data: 'n' }]));
    expect(Object.keys(one.body.files)).toEqual(['course.xml']);
    expect(one.report.map((l) => l.text)).toEqual(['Archive entries with an unsafe path (“..”, a NUL character or over 1024 characters) were not read: 1 entry']);
  });

  it('flags type, size and empty (0 bytes, whitespace-only < 1 MB) static files', async () => {
    const res = await read(course([
      { path: 'c/static/a.exe', data: 'MZ' },
      { path: 'c/static/noext', data: 'x' },
      { path: 'c/static/dir.png/inner', data: 'x' },
      { path: 'c/static/UPPER.PNG', data: 'png' },
      { path: 'c/static/big.png', data: 'x'.repeat(101) },
      { path: 'c/static/edge.png', data: 'x'.repeat(100) },
      { path: 'c/static/zero.pdf', data: '' },
      { path: 'c/static/blank.csv', data: ' \n\t ' },
      { path: 'c/static/ok.pdf', data: '%PDF' },
      { path: 'c/static/huge.exe', data: 'x'.repeat(101) },
      { path: 'c/static/.png', data: 'png' },
    ]), { limits: { maxFileBytes: 100, maxTotalBytes: 10_000 } });
    expect(res.body.static).toEqual([
      { path: '.png', size: 3, skipped: null },
      { path: 'UPPER.PNG', size: 3, skipped: null },
      { path: 'a.exe', size: 2, skipped: 'type' },
      { path: 'big.png', size: 101, skipped: 'size' },
      { path: 'blank.csv', size: 4, skipped: 'empty' },
      { path: 'dir.png/inner', size: 1, skipped: 'type' },
      { path: 'edge.png', size: 100, skipped: null },
      { path: 'huge.exe', size: 101, skipped: 'type' },
      { path: 'noext', size: 1, skipped: 'type' },
      { path: 'ok.pdf', size: 4, skipped: null },
      { path: 'zero.pdf', size: 0, skipped: 'empty' },
    ]);
    expect([...res.blobs.keys()].sort()).toEqual(['.png', 'UPPER.PNG', 'edge.png', 'ok.pdf']);
    const texts = res.report.map((l) => l.text);
    expect(texts).toContain('The file “a.exe” has a type Mathion does not accept, so it was not uploaded; convert it to an accepted type and upload it by hand');
    expect(texts).toContain('The file “big.png” is over the per-file limit, so it was not uploaded; make it smaller and upload it by hand');
    expect(texts).toContain('The file “zero.pdf” is empty, so it was not uploaded; upload it by hand if a page needs it');
    expect(texts).toContain('The file “blank.csv” is empty, so it was not uploaded; upload it by hand if a page needs it');
    expect(res.report.every((l) => l.level === 'skipped' && l.where === '')).toBe(true);
    expect(res.report).toHaveLength(7);
  });

  it('treats each of bytes 9, 10, 11, 12, 13 and 32 and a mix as whitespace', async () => {
    const ws = [9, 10, 11, 12, 13, 32].map((b, i) => ({ path: `c/static/w${i}.pdf`, data: new Uint8Array([b, b]) }));
    const res = await read(course([
      ...ws,
      { path: 'c/static/mix.pdf', data: new Uint8Array([9, 10, 11, 12, 13, 32]) },
      { path: 'c/static/nbsp.pdf', data: new Uint8Array([0xc2, 0xa0]) },
      { path: 'c/static/nul.pdf', data: new Uint8Array([0, 32]) },
      { path: 'c/static/fs.pdf', data: new Uint8Array([28, 32]) },
      { path: 'c/static/b160.pdf', data: new Uint8Array([160, 32]) },
    ]));
    const skipped = Object.fromEntries(res.body.static.map((s) => [s.path, s.skipped]));
    expect(skipped).toEqual({
      'b160.pdf': null, 'fs.pdf': null, 'mix.pdf': 'empty', 'nbsp.pdf': null, 'nul.pdf': null,
      'w0.pdf': 'empty', 'w1.pdf': 'empty', 'w2.pdf': 'empty', 'w3.pdf': 'empty', 'w4.pdf': 'empty', 'w5.pdf': 'empty',
    });
  });

  it('finds a shallower course.xml that appears after a deeper one and after other files', async () => {
    const res = await read([
      { path: 'x/y/course.xml', data: '<deep/>' },
      { path: 'x/html/a.html', data: 'a' },
      { path: 'x/static/s.png', data: 'png' },
      { path: 'x/course.xml', data: '<top/>' },
    ]);
    expect(res.body.files['course.xml']).toBe('<top/>');
    expect(res.body.files['y/course.xml']).toBe('<deep/>');
    expect(res.body.files['html/a.html']).toBe('a');
    expect(res.body.static.map((s) => s.path)).toEqual(['s.png']);
    const top = await read([{ path: 'a/b/course.xml', data: '<b/>' }, { path: 'course.xml', data: '<root/>' }, { path: 'html/z.html', data: 'z' }]);
    expect(top.body.files['course.xml']).toBe('<root/>');
    expect(top.body.files['a/b/course.xml']).toBe('<b/>');
    const fakes = await read([
      { path: 'course.xml', type: '2', linkname: 'c/course.xml' },
      { path: 'mycourse.xml', data: '<no/>' },
      { path: 'c/course.xml', data: '<c/>' },
    ]);
    expect(fakes.body.files).toEqual({ 'course.xml': '<c/>' });
  });

  it('counts skipped bodies and headers toward the 5 GB guard, per pass', async () => {
    const entries = course([{ path: 'other/big.bin', data: 'x'.repeat(5000) }, { path: 'c/html/a.html', data: 'a' }]);
    const length = tar(entries).length;
    await expect(read(entries, { gz: false, caps: { decompressed: length } })).resolves.toBeTruthy();
    await expect(read(entries, { gz: false, caps: { decompressed: length - 1 } })).rejects.toThrow(ReadError);
    await expect(read(entries, { caps: { decompressed: length - 1 } })).rejects.toThrow('5 GB');
  });

  it('keeps a whitespace-only file of 1 MB as a kept file (the server refuses it later)', async () => {
    const res = await read(course([
      { path: 'c/static/one.pdf', data: ' '.repeat(MB) },
      { path: 'c/static/under.pdf', data: ' '.repeat(MB - 1) },
    ]));
    expect(res.body.static).toEqual([
      { path: 'one.pdf', size: MB, skipped: null },
      { path: 'under.pdf', size: MB - 1, skipped: 'empty' },
    ]);
    expect(res.blobs.get('one.pdf')!.size).toBe(MB);
  });

  it('stops on kept total over the limit, on the 5 GB guard, on text caps, on 40 MB JSON', async () => {
    const two = course([{ path: 'c/static/a.pdf', data: 'aaaaaa' }, { path: 'c/static/b.pdf', data: 'bbbbbb' }]);
    await expect(read(two, { limits: { maxFileBytes: 100, maxTotalBytes: 12 } })).resolves.toBeTruthy();
    await expect(read(two, { limits: { maxFileBytes: 100, maxTotalBytes: 11 } })).rejects.toThrow(ReadError);
    const skippedBig = course([{ path: 'c/static/a.exe', data: 'x'.repeat(50) }]);
    await expect(read(skippedBig, { limits: { maxFileBytes: 100, maxTotalBytes: 10 } })).resolves.toBeTruthy();
    const texts = course([{ path: 'c/html/a.html', data: 'aaaa' }, { path: 'c/html/b.html', data: 'bbbb' }]);
    const textBytes = 22 + 8;
    await expect(read(texts, { caps: { textBytes } })).resolves.toBeTruthy();
    const withBad = course([{ path: 'c/html/bad.html', data: new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]) }, ...texts.slice(1)]);
    await expect(read(withBad, { caps: { textBytes } })).resolves.toBeTruthy();
    const withNul = course([{ path: 'c/html/nul.html', data: 'a\0bc' }, ...texts.slice(1)]);
    await expect(read(withNul, { caps: { textBytes } })).resolves.toBeTruthy();
    await expect(read(texts, { caps: { textBytes: textBytes - 1 } })).rejects.toThrow(ReadError);
    await expect(read(texts, { caps: { textEntries: 3 } })).resolves.toBeTruthy();
    await expect(read(texts, { caps: { textEntries: 2 } })).rejects.toThrow(ReadError);
    const unreadable = course([{ path: 'c/html/bad.html', data: new Uint8Array([0xff]) }, { path: 'c/html/nul.html', data: 'a\0' }]);
    await expect(read(unreadable, { caps: { textEntries: 3 } })).resolves.toBeTruthy();
    await expect(read(unreadable, { caps: { textEntries: 2 } })).rejects.toThrow(ReadError);
    const ok = await read(texts);
    await expect(read(texts, { caps: { jsonBytes: ok.jsonBytes } })).resolves.toBeTruthy();
    await expect(read(texts, { caps: { jsonBytes: ok.jsonBytes - 1 } })).rejects.toThrow(ReadError);
  });

  it('stops on more static or app files than the server accepts', async () => {
    const three = course(['a', 'b', 'c'].map((n) => ({ path: `c/static/${n}.exe`, data: 'x' })));
    await expect(read(three, { caps: { fileEntries: 3 } })).resolves.toBeTruthy();
    await expect(read(three, { caps: { fileEntries: 2 } })).rejects.toThrow(ReadError);
    const apps = ['a.js', 'b.js', 'c.js'].map((n) => new File(['x'], n));
    await expect(read(course(), { apps, caps: { fileEntries: 3 } })).resolves.toBeTruthy();
    await expect(read(course(), { apps, caps: { fileEntries: 2 } })).rejects.toThrow(ReadError);
  });

  it('skips non-UTF-8 text files with a report line', async () => {
    const res = await read(course([
      { path: 'c/html/bad.html', data: new Uint8Array([0x3c, 0x70, 0xff, 0xfe]) },
      { path: 'c/html/good.html', data: 'ünï' },
    ]));
    expect(Object.keys(res.body.files).sort()).toEqual(['course.xml', 'html/good.html']);
    expect(res.body.files['html/good.html']).toBe('ünï');
    expect(res.report).toEqual([
      { level: 'skipped', where: '', text: 'The file “html/bad.html” is not UTF-8 text, so it was not read' },
    ]);
  });

  it('ignores drafts/ about/ info/ assets/ tabs/ and static text files', async () => {
    const res = await read(course([
      ...['drafts/d.xml', 'about/a.html', 'info/i.html', 'assets/assets.xml', 'tabs/t.xml'].map((p) => ({ path: `c/${p}`, data: 'x' })),
      { path: 'c/static/page.html', data: '<p>static</p>' },
      { path: 'c/policies/x.txt', data: 'x' },
      { path: 'c/html/data.json', data: '{}' },
      { path: 'c/policies/2026/grading_policy.json', data: '{}' },
      { path: 'c/other/readme.txt', data: 'x' },
      { path: 'c/statics/s.html', data: 'not static' },
      { path: 'outside/html/o.html', data: 'x' },
    ]));
    expect(Object.keys(res.body.files).sort()).toEqual(['course.xml', 'policies/2026/grading_policy.json', 'statics/s.html']);
    expect(res.body.static).toEqual([{ path: 'page.html', size: 13, skipped: 'type' }]);
  });

  it('keeps the first of repeated entries and app files', async () => {
    const apps = [new File(['first'], 'a.js'), new File(['second!'], 'a.js')];
    const res = await read(course([
      { path: 'c/html/a.html', data: 'first' },
      { path: 'c/html/a.html', data: 'second' },
      { path: 'c/static/s.pdf', data: 'one' },
      { path: 'c/static/s.pdf', data: 'two!' },
    ]), { apps });
    expect(res.body.files['html/a.html']).toBe('first');
    expect(res.body.static).toEqual([{ path: 's.pdf', size: 3, skipped: null }]);
    expect(res.body.apps).toEqual([{ name: 'a.js', size: 5 }]);
    expect(res.blobs.get('app:a.js')!.size).toBe(5);
  });

  it('takes the first course.xml when two are equally shallow', async () => {
    const res = await read([{ path: 'b/course.xml', data: '<b/>' }, { path: 'a/course.xml', data: '<a/>' }]);
    expect(res.body.files['course.xml']).toBe('<b/>');
  });

  it('skips text files holding a NUL character and strips a BOM', async () => {
    const res = await read(course([
      { path: 'c/html/nul.html', data: '<p>pasted\0</p>' },
      { path: 'c/html/bom.html', data: '\uFEFF<p>bom</p>' },
    ]));
    expect(res.body.files['html/bom.html']).toBe('<p>bom</p>');
    expect('html/nul.html' in res.body.files).toBe(false);
    expect(res.report).toEqual([
      { level: 'skipped', where: '', text: 'The file “html/nul.html” holds a NUL character, so it was not read' },
    ]);
  });

  it('ignores macOS AppleDouble ._ files and __MACOSX folders in both passes', async () => {
    const res = await read([
      { path: '__MACOSX/course.xml', data: '<mac/>' },
      { path: 'c/course.xml', data: '<c/>' },
      { path: 'c/._course.xml', data: new Uint8Array([0, 5, 22, 7, 0xff]) },
      { path: 'c/html/._a.html', data: new Uint8Array([0, 5, 22, 7, 0xff]) },
      { path: 'c/static/._fig.png', data: 'apple' },
      { path: 'c/static/img/._b.pdf', data: 'apple' },
      { path: 'c/static/img/b.pdf', data: '%PDF' },
      { path: 'c/__MACOSX/html/x.html', data: 'x' },
      { path: 'c/static/._dir/x.png', data: 'png' },
      { path: 'c/static/x__MACOSX/y.png', data: 'png' },
      { path: 'c/static/.DS_Store', data: 'ds' },
      { path: 'c/static/img/.DS_Store', data: 'ds' },
      { path: 'c/static/Thumbs.db', data: 'tb' },
      { path: 'c/static/img/THUMBS.DB', data: 'tb' },
      { path: 'c/static/desktop.ini', data: 'di' },
    ]);
    expect(res.body.files).toEqual({ 'course.xml': '<c/>' });
    expect(res.body.static).toEqual([
      { path: '._dir/x.png', size: 3, skipped: null },
      { path: 'img/b.pdf', size: 4, skipped: null },
      { path: 'x__MACOSX/y.png', size: 3, skipped: null },
    ]);
    expect(res.report).toEqual([]);
  });

  it('stops on an app file name the server cannot take', async () => {
    const ok = new File(['x'], 'a'.repeat(252) + '.js');
    await expect(read(course(), { apps: [ok] })).resolves.toBeTruthy();
    await expect(read(course(), { apps: [new File(['x'], '😀'.repeat(200))] })).resolves.toBeTruthy();
    for (const name of ['sine\\demo.js', 'a'.repeat(253) + '.js', 'a/b.js']) {
      await expect(read(course(), { apps: [new File(['x'], name)] })).rejects.toThrow(`The app file “${name}”`);
    }
    await expect(read(course(), { apps: [new File(['x'], '')] })).rejects.toThrow('The app file “”');
    await expect(read(course(), { apps: [new File(['x'], 'a\0b.js')] })).rejects.toThrow('The app file “a?b.js”');
    const del = Object.assign(new Blob(['x']), { name: 'a\x7f/b.js' }) as File;
    await expect(read(course(), { apps: [del] })).rejects.toThrow('The app file “a?/b.js”');
    const lone = Object.assign(new Blob(['x']), { name: 'a\ud800b.js' }) as File;
    await expect(read(course(), { apps: [lone] })).rejects.toThrow(ReadError);
  });

  it('stops with a plain message when the picked file cannot be read', async () => {
    const bytes = await gzip(tar(course()));
    const failing = (err: unknown): ArchiveSource => {
      let calls = 0;
      return {
        name: 'c.tar.gz', size: bytes.length,
        stream: () => (calls++ === 0 ? file(bytes).stream() : new ReadableStream<Uint8Array>({ start: (c) => c.error(err) })),
      };
    };
    await expect(readExport(failing(new DOMException('gone', 'NotReadableError')), [], LIMITS)).rejects.toThrow('could not be read');
    await expect(readExport(failing(new Error('boom')), [], LIMITS)).rejects.toThrow('damaged');
  });

  it('tells gzip from a plain tar by both magic bytes', async () => {
    const first = tar(course([], 'c'));
    const lead1 = tar([{ path: '\x1fb', data: 'x' }, ...course()]);
    const lead2 = tar([{ path: 'ab', data: 'x' }, ...course()]);
    lead2[1] = 0x8b;
    rechecksum(lead2);
    for (const bytes of [first, lead1, lead2]) {
      expect((await readExport(file(bytes, 'c.tar'), [], LIMITS)).body.files['course.xml']).toBe('<course url_name="r"/>');
    }
  });

  it('checks every chunk of a file for whitespace', async () => {
    const res = await read(course([{ path: 'c/static/late.pdf', data: ' '.repeat(900_000) + 'x' }]));
    expect(res.body.static).toEqual([{ path: 'late.pdf', size: 900_001, skipped: null }]);
  });

  it('uses the spec caps by default', () => {
    expect(READ_CAPS).toEqual({ decompressed: 5 * 1024 * MB, textBytes: 20 * MB, textEntries: 20000, jsonBytes: 40 * MB, fileEntries: 20000 });
  });

  it('does not count a small whitespace-only file toward the kept total', async () => {
    const res = await read(course([
      { path: 'c/static/a.pdf', data: 'aaaaaaaaaa' },
      { path: 'c/static/blank.csv', data: ' ' },
    ]), { limits: { maxFileBytes: 100, maxTotalBytes: 10 } });
    expect(res.body.static.map((e) => [e.path, e.skipped])).toEqual([['a.pdf', null], ['blank.csv', 'empty']]);
  });

  it('refuses paths over 1024 characters as unsafe', async () => {
    const at = (n: number) => 'c/html/' + 'p'.repeat(n - 12) + '.html';
    const res = await read(course([
      { path: at(1024), longName: true, data: 'ok' },
      { path: at(1025), longName: true, data: 'long' },
    ]));
    expect(Object.keys(res.body.files).sort()).toEqual(['course.xml', at(1024).slice(2)]);
    expect(res.report.map((l) => l.text)).toEqual([
      'Archive entries with an unsafe path (“..”, a NUL character or over 1024 characters) were not read: 1 entry',
    ]);
  });

  it('reads a plain .tar without gzip', async () => {
    const res = await read(course([{ path: 'c/html/a.html', data: 'plain' }]), { gz: false });
    expect(res.body.files['html/a.html']).toBe('plain');
  });

  it('stops with a plain message for a file that is not an export', async () => {
    await expect(readExport(file(new Uint8Array(2048).fill(65), 'x.tar.gz'), [], LIMITS)).rejects.toThrow(ReadError);
    await expect(readExport(file(new Uint8Array([0x1f, 0x8b, 1, 2, 3, 4, 5, 6, 7, 8])), [], LIMITS)).rejects.toThrow(ReadError);
    await expect(readExport(file(new Uint8Array(0)), [], LIMITS)).rejects.toThrow(ReadError);
    await expect(read([{ path: 'c/html/a.html', data: 'no course' }])).rejects.toThrow('course.xml');
  });

  it('ALLOWED_EXTENSIONS matches the backend list', () => {
    const src = fs().readFileSync('../backend/mathion/assets.py', 'utf8');
    const block = /ALLOWED_EXTENSIONS = \{([^}]*)\}/.exec(src)![1];
    const backend = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual(backend);
  });
});

// ArchiveSource is structural: a Node File satisfies it.
export const _typeCheck: (f: File) => ArchiveSource = (f) => f;
