import { describe, expect, it } from 'vitest';
import { readTar, TarError, type TarEntry } from '../lib/olx/tar';
import { rechecksum, streamOf, tar } from './support/tarWriter';

async function text(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    total.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(total);
}

async function code(bytes: Uint8Array): Promise<string> {
  try {
    await all(bytes, true, 4096);
  } catch (err) {
    return err instanceof TarError ? err.code : String(err);
  }
  return 'ok';
}

function patched(entries: Parameters<typeof tar>[0], edit: (h: Uint8Array) => void): Uint8Array {
  const bytes = tar(entries);
  edit(bytes.subarray(0, 512));
  rechecksum(bytes);
  return bytes;
}

async function all(bytes: Uint8Array, read = true, chunk = 7): Promise<{ entry: TarEntry; text: string }[]> {
  const out = [];
  for await (const entry of readTar(streamOf(bytes, chunk))) {
    out.push({ entry, text: read ? await text(entry.body) : '' });
  }
  return out;
}

describe('readTar', () => {
  it('reads plain ustar entries across chunk edges', async () => {
    const got = await all(tar([{ path: 'a.txt', data: 'hello' }, { path: 'dir/b.txt', data: 'x'.repeat(1000) }]));
    expect(got.map((g) => [g.entry.path, g.entry.size, g.entry.type, g.text.length])).toEqual([
      ['a.txt', 5, 'file', 5],
      ['dir/b.txt', 1000, 'file', 1000],
    ]);
  });

  it('handles ustar prefix, GNU long names, pax path/size and base-256 sizes', async () => {
    const long = 'deep/' + 'n'.repeat(150) + '/file.xml';
    const bytes = tar([
      { path: 'name.xml', prefix: 'some/prefix', data: 'p' },
      { path: long, longName: true, data: 'long' },
      { path: 'short', pax: { path: 'pax/ünïcode name.xml', size: '700' }, size: 0, data: 'z'.repeat(700) },
      { path: 'g', type: 'g', data: '10 path=x\n' },
      { path: 'b256.bin', base256: true, data: 'b'.repeat(600) },
      { path: 'after.txt', data: 'end' },
    ]);
    const got = await all(bytes);
    expect(got.map((g) => [g.entry.path, g.entry.size, g.text.length])).toEqual([
      ['some/prefix/name.xml', 1, 1],
      [long, 4, 4],
      ['pax/ünïcode name.xml', 700, 700],
      ['b256.bin', 600, 600],
      ['after.txt', 3, 3],
    ]);
    expect(got[2].text).toBe('z'.repeat(700));
  });

  it('skips directories and links; truncated archive throws', async () => {
    const bytes = tar([
      { path: 'dir/', type: '5' },
      { path: 'link', type: '2', linkname: 'a.txt' },
      { path: 'hard', type: '1', linkname: 'a.txt' },
      { path: 'a.txt', data: 'hi' },
    ]);
    const got = await all(bytes);
    expect(got.map((g) => [g.entry.path, g.entry.type, g.entry.body === null])).toEqual([
      ['dir/', 'other', true],
      ['link', 'other', true],
      ['hard', 'other', true],
      ['a.txt', 'file', false],
    ]);
    const full = tar([{ path: 'a.txt', data: 'x'.repeat(2000) }]);
    await expect(all(full.slice(0, 1200))).rejects.toThrow(TarError);
    await expect(all(full.slice(0, 1200), false)).rejects.toThrow(TarError);
    await expect(all(full.slice(0, 300))).rejects.toThrow(TarError);
    await expect(all(tar([{ path: 'a.txt', data: 'x' }], { end: false }))).rejects.toThrow(TarError);
  });

  it('skips the unread part of a body, cancelled or not', async () => {
    const bytes = tar([{ path: 'a', data: 'a'.repeat(3000) }, { path: 'b', data: 'b'.repeat(3000) }, { path: 'c', data: 'c' }]);
    const paths: string[] = [];
    let n = 0;
    for await (const entry of readTar(streamOf(bytes, 100))) {
      paths.push(entry.path);
      if (n === 0) await entry.body?.cancel();
      if (n === 1) {
        const reader = entry.body!.getReader();
        await reader.read();
        reader.releaseLock();
      }
      n += 1;
    }
    expect(paths).toEqual(['a', 'b', 'c']);
  });

  it('ignores the prefix field of a GNU header', async () => {
    const got = await all(tar([{ path: 'gnu.xml', prefix: 'atime-bytes', gnu: true, data: 'g' }]));
    expect(got.map((g) => g.entry.path)).toEqual(['gnu.xml']);
  });

  it('refuses a block that is not a tar header', async () => {
    const junk = new Uint8Array(1024).fill(65);
    await expect(all(junk)).rejects.toThrow(TarError);
    const bad = tar([{ path: 'a.txt', data: 'x' }]);
    bad[0] = 'b'.charCodeAt(0); // name changed, checksum not
    await expect(all(bad)).rejects.toThrow(TarError);
  });

  it('parses number fields strictly', async () => {
    const one = [{ path: 'a', data: 'x', base256: true }];
    expect(await code(patched(one, (h) => { h[124] = 0xff; }))).toBe('header');
    expect(await code(patched(one, (h) => { h[124] = 0x80; h.fill(0xff, 125, 136); }))).toBe('header');
    expect(await code(patched([{ path: 'd/', type: '5' }], (h) => { h.set(new TextEncoder().encode('0000000009\0'), 124); }))).toBe('header');
    const empty = await all(patched([{ path: 'd/', type: '5' }], (h) => { h.fill(0, 124, 136); }));
    expect(empty.map((g) => [g.entry.path, g.entry.size])).toEqual([['d/', 0]]);
    const seven = tar([{ path: 'a', data: 'x' }]);
    rechecksum(seven, 0, true);
    expect((await all(seven)).map((g) => g.text)).toEqual(['x']);
  });

  it('refuses malformed pax records and pax sizes', async () => {
    for (const paxRaw of ['11 path=abX', '10path=ab\n', '8 abcde\n']) {
      expect(await code(tar([{ path: 'a', paxRaw, data: 'x' }]))).toBe('header');
    }
    for (const size of ['abc', '-1', '99999999999999999999']) {
      expect(await code(tar([{ path: 'a', pax: { size }, data: 'x' }]))).toBe('header');
    }
  });

  it('merges pax headers and prefers the pax path over a long name', async () => {
    const got = await all(tar([
      { path: 'short', pax: [{ path: 'p/first.txt' }, { size: '3' }], size: 0, data: 'abc' },
      { path: 'l/' + 'n'.repeat(120), longName: true, pax: { path: 'pax-wins.txt' }, data: 'w' },
      { path: 'short2', pax: [{ size: '3' }, { path: 'p/second.txt' }], size: 0, data: 'xyz' },
    ]));
    expect(got.map((g) => [g.entry.path, g.entry.size, g.text])).toEqual([
      ['p/first.txt', 3, 'abc'], ['pax-wins.txt', 1, 'w'], ['p/second.txt', 3, 'xyz'],
    ]);
  });

  it('reads typeflags NUL and 7 as files, skips K records and the bodies of other entries', async () => {
    const got = await all(tar([
      { path: 'nul.txt', type: '\0', data: 'n' },
      { path: 'cont.txt', type: '7', data: 'c' },
      { path: 'link', type: '2', linkname: 'x', linkLong: 'very/' + 'long/'.repeat(30) + 'target' },
      { path: 'fifo', type: '6', data: '0123456789' },
      { path: 'after.txt', data: 'end' },
    ]));
    expect(got.map((g) => [g.entry.path, g.entry.type, g.text])).toEqual([
      ['nul.txt', 'file', 'n'], ['cont.txt', 'file', 'c'], ['link', 'other', ''], ['fifo', 'other', ''], ['after.txt', 'file', 'end'],
    ]);
  });

  it('treats a regular entry whose path ends in / as a directory', async () => {
    const got = await all(tar([{ path: 'img/', type: '0' }, { path: 'img/a.png', data: 'p' }]));
    expect(got.map((g) => [g.entry.path, g.entry.type, g.entry.body === null])).toEqual([['img/', 'other', true], ['img/a.png', 'file', false]]);
  });

  it('reads a block-aligned long name and caps long names at 1 MB', async () => {
    const aligned = 'a'.repeat(511);
    expect((await all(tar([{ path: aligned, longName: true, data: 'x' }, { path: 'b', data: 'y' }]))).map((g) => g.entry.path)).toEqual([aligned, 'b']);
    const max = 'm'.repeat(1024 * 1024 - 1);
    expect((await all(tar([{ path: max, longName: true, data: 'x' }]), true, 65536)).map((g) => g.entry.path.length)).toEqual([max.length]);
    expect(await code(tar([{ path: max + 'm', longName: true, data: 'x' }]))).toBe('header');
  });

  it('closes an unread body once the next entry is asked for', async () => {
    const bytes = tar([{ path: 'a', data: 'a'.repeat(3000) }, { path: 'b', data: 'b'.repeat(3000) }]);
    const entries = readTar(streamOf(bytes, 100))[Symbol.asyncIterator]();
    const a = (await entries.next()).value as TarEntry;
    const b = (await entries.next()).value as TarEntry;
    expect((await a.body!.getReader().read()).done).toBe(true);
    expect(await text(b.body)).toBe('b'.repeat(3000));
  });

  it('cancels the source when the reader stops early or fails', async () => {
    const { ReadableStream: RS } = process.getBuiltinModule('node:stream/web');
    const source = (bytes: Uint8Array) => {
      const inner = streamOf(bytes).getReader();
      const state = { cancelled: false };
      const stream = new RS<Uint8Array>({
        async pull(c) {
          const { done, value } = await inner.read();
          if (done) c.close();
          else c.enqueue(value);
        },
        cancel() {
          state.cancelled = true;
        },
      });
      return { stream, state };
    };
    const early = source(tar([{ path: 'a', data: 'x' }, { path: 'b', data: 'y' }]));
    for await (const entry of readTar(early.stream)) {
      await entry.body?.cancel();
      break;
    }
    expect(early.state.cancelled).toBe(true);
    const bad = source(new Uint8Array(2048).fill(65));
    await expect((async () => { for await (const e of readTar(bad.stream)) await e.body?.cancel(); })()).rejects.toThrow(TarError);
    expect(bad.state.cancelled).toBe(true);
  });
});
