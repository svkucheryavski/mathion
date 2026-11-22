// A tiny tar writer for the OLX reader tests: ustar headers, GNU long names, pax records, base-256 sizes.

export type TarSpec = {
  path: string;
  data?: Uint8Array | string;
  type?: string; // typeflag; '0' by default
  size?: number; // header size field, when it must differ from the data length
  prefix?: string; // ustar prefix field
  base256?: boolean; // size field in base-256
  longName?: boolean; // write the path as a GNU ././@LongLink record
  pax?: Record<string, string> | Record<string, string>[]; // pax headers before this entry
  paxRaw?: string; // a raw pax record block before this entry
  linkLong?: string; // a GNU ././@LongLink K record before this entry
  linkname?: string;
  gnu?: boolean; // GNU magic; the prefix bytes then mean something else
};

const enc = new TextEncoder();
const BLOCK = 512;

function bytesOf(data: Uint8Array | string | undefined): Uint8Array {
  if (data === undefined) return new Uint8Array(0);
  return typeof data === 'string' ? enc.encode(data) : data;
}

function put(h: Uint8Array, at: number, len: number, text: string): void {
  h.set(enc.encode(text).subarray(0, len), at);
}

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

function header(spec: { name: string; size: number; type: string; prefix?: string; base256?: boolean; linkname?: string; gnu?: boolean }): Uint8Array {
  const h = new Uint8Array(BLOCK);
  put(h, 0, 100, spec.name);
  put(h, 100, 8, octal(0o644, 8));
  put(h, 108, 8, octal(0, 8));
  put(h, 116, 8, octal(0, 8));
  if (spec.base256) {
    h[124] = 0x80;
    let n = spec.size;
    for (let i = 135; i > 124; i--) {
      h[i] = n % 256;
      n = Math.floor(n / 256);
    }
  } else {
    put(h, 124, 12, octal(spec.size, 12));
  }
  put(h, 136, 12, octal(0, 12));
  h[156] = spec.type.charCodeAt(0);
  if (spec.linkname) put(h, 157, 100, spec.linkname);
  put(h, 257, 6, spec.gnu ? 'ustar ' : 'ustar\0');
  put(h, 263, 2, spec.gnu ? ' \0' : '00');
  if (spec.prefix) put(h, 345, 155, spec.prefix);
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  put(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}

/** Recompute the checksum of the header at offset `at`; `seven` writes seven digits and a NUL. */
export function rechecksum(bytes: Uint8Array, at = 0, seven = false): void {
  const h = bytes.subarray(at, at + BLOCK);
  h.fill(32, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  put(h, 148, 8, seven ? sum.toString(8).padStart(7, '0') + '\0' : sum.toString(8).padStart(6, '0') + '\0 ');
}

function padded(data: Uint8Array): Uint8Array[] {
  const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
  return [data, new Uint8Array(pad)];
}

function paxRecords(records: Record<string, string>): Uint8Array {
  let out = '';
  for (const [key, value] of Object.entries(records)) {
    const body = ` ${key}=${value}\n`;
    let len = enc.encode(body).length + 1;
    while (String(len).length + enc.encode(body).length !== len) len += 1;
    out += `${len}${body}`;
  }
  return enc.encode(out);
}

export function tar(entries: TarSpec[], { end = true }: { end?: boolean } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    const data = bytesOf(e.data);
    for (const records of e.pax ? [e.pax].flat() : []) {
      const rec = paxRecords(records);
      parts.push(header({ name: 'PaxHeader/x', size: rec.length, type: 'x' }), ...padded(rec));
    }
    if (e.paxRaw !== undefined) {
      const rec = enc.encode(e.paxRaw);
      parts.push(header({ name: 'PaxHeader/x', size: rec.length, type: 'x' }), ...padded(rec));
    }
    if (e.linkLong !== undefined) {
      const long = enc.encode(e.linkLong + '\0');
      parts.push(header({ name: '././@LongLink', size: long.length, type: 'K' }), ...padded(long));
    }
    let name = e.path;
    if (e.longName) {
      const long = enc.encode(e.path + '\0');
      parts.push(header({ name: '././@LongLink', size: long.length, type: 'L' }), ...padded(long));
      name = e.path.slice(0, 100);
    }
    parts.push(header({ name, size: e.size ?? data.length, type: e.type ?? '0', prefix: e.prefix, base256: e.base256, linkname: e.linkname, gnu: e.gnu }));
    parts.push(...padded(data));
  }
  if (end) parts.push(new Uint8Array(BLOCK * 2));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A stream of the bytes in small chunks, so headers and bodies cross chunk edges. */
export function streamOf(bytes: Uint8Array, chunk = 7): ReadableStream<Uint8Array> {
  const { ReadableStream: RS } = process.getBuiltinModule('node:stream/web');
  let at = 0;
  return new RS<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
  });
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const { CompressionStream: CS } = process.getBuiltinModule('node:stream/web');
  const out = (streamOf(bytes, 4096) as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(new CS('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = out.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const res = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    res.set(c, at);
    at += c.length;
  }
  return res;
}
