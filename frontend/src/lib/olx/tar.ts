// Mathion's own small tar reader: ustar prefix, GNU long names, pax path/size, base-256 sizes.

export class TarError extends Error {
  constructor(readonly code: 'truncated' | 'header') {
    super(`tar: ${code}`);
    this.name = 'TarError';
  }
}

export type TarEntry = { path: string; size: number; type: 'file' | 'other'; body: ReadableStream<Uint8Array> | null };

const BLOCK = 512;
const MAX_META = 1024 * 1024; // long names and pax records
const utf8 = new TextDecoder();

class ByteReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private ended = false;

  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private async fill(n: number): Promise<boolean> {
    while (this.buffered < n && !this.ended) {
      const { done, value } = await this.reader.read();
      if (done) this.ended = true;
      else if (value.length) {
        this.chunks.push(value);
        this.buffered += value.length;
      }
    }
    return this.buffered >= n;
  }

  private consume(k: number): void {
    const c = this.chunks[0];
    if (k === c.length) this.chunks.shift();
    else this.chunks[0] = c.subarray(k);
    this.buffered -= k;
  }

  async atEnd(): Promise<boolean> {
    return !(await this.fill(1));
  }

  /** Exactly n bytes. */
  async take(n: number): Promise<Uint8Array> {
    if (!(await this.fill(n))) throw new TarError('truncated');
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const k = Math.min(this.chunks[0].length, n - at);
      out.set(this.chunks[0].subarray(0, k), at);
      at += k;
      this.consume(k);
    }
    return out;
  }

  /** Between 1 and n bytes, without copying. */
  async some(n: number): Promise<Uint8Array> {
    if (!(await this.fill(1))) throw new TarError('truncated');
    const k = Math.min(this.chunks[0].length, n);
    const out = this.chunks[0].subarray(0, k);
    this.consume(k);
    return out;
  }

  async skip(n: number): Promise<void> {
    while (n > 0) {
      if (!(await this.fill(1))) throw new TarError('truncated');
      const k = Math.min(this.chunks[0].length, n);
      this.consume(k);
      n -= k;
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

function text(h: Uint8Array, at: number, len: number): string {
  let end = at;
  while (end < at + len && h[end] !== 0) end++;
  return utf8.decode(h.subarray(at, end));
}

function number(h: Uint8Array, at: number, len: number): number {
  if (h[at] & 0x80) {
    if (h[at] === 0xff) throw new TarError('header'); // negative
    let n = h[at] & 0x7f;
    for (let i = at + 1; i < at + len; i++) n = n * 256 + h[i];
    if (!Number.isSafeInteger(n)) throw new TarError('header');
    return n;
  }
  const s = text(h, at, len).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw new TarError('header');
  return parseInt(s, 8);
}

function checksumOk(h: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return number(h, 148, 8) === sum;
}

function paxRecords(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  let pos = 0;
  while (pos < data.length) {
    let space = pos;
    while (space < data.length && data[space] >= 48 && data[space] <= 57) space++;
    const len = parseInt(utf8.decode(data.subarray(pos, space)), 10);
    if (data[space] !== 32 || !(len > space - pos) || pos + len > data.length || data[pos + len - 1] !== 10) {
      throw new TarError('header');
    }
    const record = utf8.decode(data.subarray(space + 1, pos + len - 1));
    const eq = record.indexOf('=');
    if (eq < 0) throw new TarError('header');
    out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

function paxSize(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new TarError('header');
  return Number(value);
}

/** The archive's entries in order; read or cancel each body before asking for the next entry. */
export async function* readTar(stream: ReadableStream<Uint8Array>): AsyncGenerator<TarEntry> {
  const bytes = new ByteReader(stream.getReader());
  let longName: string | null = null;
  let pax: { path?: string; size?: string } = {};
  try {
    for (;;) {
      if (await bytes.atEnd()) throw new TarError('truncated'); // no end-of-archive block
      const h = await bytes.take(BLOCK);
      if (h.every((b) => b === 0)) return;
      if (!checksumOk(h)) throw new TarError('header');
      const type = h[156] === 0 ? '0' : String.fromCharCode(h[156]);
      const headerSize = number(h, 124, 12);
      if (type === 'L' || type === 'K' || type === 'x' || type === 'g') {
        const padding = (BLOCK - (headerSize % BLOCK)) % BLOCK;
        if (type === 'K' || type === 'g') {
          await bytes.skip(headerSize + padding);
          continue;
        }
        if (headerSize > MAX_META) throw new TarError('header');
        const data = await bytes.take(headerSize);
        await bytes.skip(padding);
        if (type === 'L') longName = text(data, 0, data.length);
        else {
          const records = paxRecords(data); // only path and size are kept
          if (records.path !== undefined) pax.path = records.path;
          if (records.size !== undefined) pax.size = records.size;
        }
        continue;
      }
      const size = pax.size !== undefined ? paxSize(pax.size) : headerSize;
      const padding = (BLOCK - (size % BLOCK)) % BLOCK;
      let path: string;
      if (pax.path !== undefined) path = pax.path;
      else if (longName !== null) path = longName;
      else {
        const name = text(h, 0, 100);
        const posix = String.fromCharCode(...h.subarray(257, 263)) === 'ustar\0';
        const prefix = posix ? text(h, 345, 155) : '';
        path = prefix ? `${prefix}/${name}` : name;
      }
      longName = null;
      pax = {};
      if ((type !== '0' && type !== '7') || path.endsWith('/')) {
        await bytes.skip(size + padding);
        yield { path, size, type: 'other', body: null };
        continue;
      }
      const state = { remaining: size, closed: false };
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            if (state.closed || state.remaining === 0) {
              state.closed = true;
              controller.close();
              return;
            }
            const chunk = await bytes.some(state.remaining);
            state.remaining -= chunk.length;
            controller.enqueue(chunk);
            if (state.remaining === 0) {
              state.closed = true;
              controller.close();
            }
          },
          cancel() {
            state.closed = true;
          },
        },
        { highWaterMark: 0 },
      );
      yield { path, size, type: 'file', body };
      state.closed = true;
      await bytes.skip(state.remaining + padding);
    }
  } finally {
    await bytes.cancel();
  }
}
