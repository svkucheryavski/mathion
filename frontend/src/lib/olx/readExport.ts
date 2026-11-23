// Read an Open edX export (.tar.gz or .tar) in the browser: the text bundle, the static files and the app files.
import { readTar, TarError, type TarEntry } from './tar';
import { blobKey, type ArchiveSource, type CheckBody, type ImportLimits, type ReportLine, type Skipped, type StaticEntry } from './types';

/** The same values as backend/mathion/assets.py ALLOWED_EXTENSIONS. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif',
  'pdf', 'csv', 'xls', 'xlsx', 'ppt', 'pptx',
  'r', 'py', 'm',
  'js',
]);

export type ReadCaps = { decompressed: number; textBytes: number; textEntries: number; jsonBytes: number; fileEntries: number };

const MB = 1024 * 1024;
const MAX_PATH = 1024; // longer archive paths are refused as unsafe

export const READ_CAPS: ReadCaps = {
  decompressed: 5 * 1024 * MB,
  textBytes: 20 * MB,
  textEntries: 20000,
  jsonBytes: 40 * MB,
  fileEntries: 20000, // the server's cap on static and app entries
};

export type ReadResult = { body: CheckBody; blobs: Map<string, Blob>; report: ReportLine[]; jsonBytes: number };

/** A plain-language reason the modal shows as is. */
export class ReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadError';
  }
}

const NOT_EXPORT = 'This file is not a course export. In Studio, use Tools › Export and pick the .tar.gz file it gives.';
const TRUNCATED = 'The archive ends too early. Download the export from Studio again.';
const DAMAGED = 'The archive is damaged. Download the export from Studio again.';
const UNREADABLE = 'The file could not be read. Pick it again.';
const NO_COURSE = 'No course.xml was found in the archive, so it is not an Open edX course export.';
const TOO_BIG = 'The archive unpacks to more than 5 GB, so it was not read.';
const TOO_MUCH_TEXT = 'The course has more than 20 MB of text or more than 20 000 text files, so it cannot be imported.';
const TOO_MANY_FILES = 'The course has more than 20 000 files, so it cannot be imported.';
const TOO_LARGE_JSON = 'The course text is too large to send (over 40 MB), so it cannot be imported.';

const WHITESPACE = new Set([9, 10, 11, 12, 13, 32]); // what Python's bytes.strip() removes
const NO_GZIP = 'This browser cannot open .tar.gz files. Update it, or unpack the export and pick the .tar file.';
const NOT_TEXT_DIRS = new Set(['static', 'drafts', 'about', 'info', 'assets', 'tabs']);

const mb = (n: number) => `${(n / MB).toFixed(1)} MB`;
const line = (text: string): ReportLine => ({ level: 'skipped', where: '', text });

/** Path with `/` separators and no leading `/` or `.` parts; null when it has `..`, a NUL or is too long. */
function cleanPath(path: string): string | null {
  if (path.length > MAX_PATH || path.includes('\0')) return null;
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  return parts.includes('..') ? null : parts.join('/');
}

const OS_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/** Operating-system clutter: macOS ._ twins, __MACOSX folders, .DS_Store, Thumbs.db, desktop.ini. */
function isOsJunk(path: string): boolean {
  const parts = path.split('/');
  const base = parts[parts.length - 1];
  return parts.includes('__MACOSX') || base.startsWith('._') || OS_FILES.has(base.toLowerCase());
}

function wellFormed(text: string): boolean {
  try {
    encodeURIComponent(text); // throws on a lone surrogate
    return true;
  } catch {
    return false;
  }
}

/** The server's AppEntry name rule; JSON with a lone surrogate is refused there too. */
function appNameOk(name: string): boolean {
  return name.length > 0 && [...name].length <= 255 && !/[\0/\\]/.test(name) && wellFormed(name);
}

function isText(rel: string): boolean {
  const top = rel.split('/')[0];
  if (top === 'policies' && rel.endsWith('.json')) return true;
  return (rel.endsWith('.xml') || rel.endsWith('.html')) && !NOT_TEXT_DIRS.has(top);
}

async function peek(stream: ReadableStream<Uint8Array>, n: number): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const got: Uint8Array[] = [];
  let len = 0;
  while (len < n) {
    const { done, value } = await reader.read();
    if (done) break;
    got.push(value);
    len += value.length;
  }
  const head = new Uint8Array(Math.min(len, n));
  let at = 0;
  for (const g of got) {
    if (at >= head.length) break;
    const part = g.subarray(0, head.length - at);
    head.set(part, at);
    at += part.length;
  }
  const rest = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        for (const g of got) controller.enqueue(g);
      },
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
  return { head, stream: rest };
}

/** The decompressed archive, stopping past the decompressed-bytes cap. */
async function open(file: ArchiveSource, caps: ReadCaps): Promise<ReadableStream<Uint8Array>> {
  const { head, stream } = await peek(file.stream(), 2);
  // File.stream() chunks are ArrayBuffer-backed; the cast only narrows the type
  const bytes = stream as ReadableStream<Uint8Array<ArrayBuffer>>;
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  if (gz && typeof DecompressionStream === 'undefined') throw new ReadError(NO_GZIP);
  const raw = gz ? bytes.pipeThrough(new DecompressionStream('gzip')) : bytes;
  let seen = 0;
  return raw.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.length;
        if (seen > caps.decompressed) throw new ReadError(TOO_BIG);
        controller.enqueue(chunk);
      },
    }),
  );
}

async function chunksOf(body: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>[]> {
  const reader = body.getReader();
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value.slice()); // own copy, so the archive's chunk is released
  }
}

function joined(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function extension(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? null : base.slice(dot + 1).toLowerCase();
}

const SKIP_TEXT: Record<Exclude<Skipped, null>, string> = {
  type: 'has a type Mathion does not accept, so it was not uploaded; convert it to an accepted type and upload it by hand',
  size: 'is over the per-file limit, so it was not uploaded; make it smaller and upload it by hand',
  empty: 'is empty, so it was not uploaded; upload it by hand if a page needs it',
};

async function findRoot(file: ArchiveSource, caps: ReadCaps): Promise<{ root: string; rejected: number }> {
  let root: string | null = null;
  let depth = Infinity;
  let rejected = 0;
  for await (const entry of readTar(await open(file, caps))) {
    await entry.body?.cancel();
    if (entry.type !== 'file') continue;
    const path = cleanPath(entry.path);
    if (path === null) {
      rejected += 1;
      continue;
    }
    if (isOsJunk(path)) continue;
    const parts = path.split('/');
    if (parts[parts.length - 1] === 'course.xml' && parts.length < depth) {
      depth = parts.length;
      root = parts.slice(0, -1).join('/');
    }
  }
  if (root === null) throw new ReadError(NO_COURSE);
  return { root, rejected };
}

async function extract(file: ArchiveSource, root: string, apps: (ArchiveSource & Blob)[], limits: ImportLimits,
                       caps: ReadCaps, report: ReportLine[]): Promise<{ body: CheckBody; blobs: Map<string, Blob> }> {
  const files = new Map<string, string>();
  const statics: StaticEntry[] = [];
  const seenStatic = new Set<string>();
  const blobs = new Map<string, Blob>();
  const appList: CheckBody['apps'] = [];
  for (const app of apps) {
    if (!appNameOk(app.name)) {
      const shown = app.name.replace(/[\u0000-\u001f\u007f]/g, '?');
      throw new ReadError(`The app file “${shown}” has a name Mathion cannot take (no / or \\, at most 255 characters); rename it and pick it again.`);
    }
    if (blobs.has(blobKey('app', app.name))) continue;
    // the server refuses a blank file, and only after the draft exists
    if (app.size < MB && new Uint8Array(await app.arrayBuffer()).every((b) => WHITESPACE.has(b))) {
      throw new ReadError(`The app file “${app.name.replace(/[\u0000-\u001f\u007f]/g, '?')}” is empty; pick the right file.`);
    }
    appList.push({ name: app.name, size: app.size });
    blobs.set(blobKey('app', app.name), app);
  }
  if (appList.length > caps.fileEntries) throw new ReadError(TOO_MANY_FILES);
  const prefix = root ? `${root}/` : '';
  let textBytes = 0;
  let textCount = 0; // unreadable files count too, so their report lines stay bounded
  let kept = 0;

  const addText = async (rel: string, entry: TarEntry) => {
    if (files.has(rel)) return entry.body!.cancel();
    textBytes += entry.size;
    textCount += 1;
    if (textCount > caps.textEntries || textBytes > caps.textBytes) throw new ReadError(TOO_MUCH_TEXT);
    const data = joined(await chunksOf(entry.body!));
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      textBytes -= entry.size;
      report.push(line(`The file “${rel}” is not UTF-8 text, so it was not read`));
      return;
    }
    if (text.includes('\0')) {
      textBytes -= entry.size;
      report.push(line(`The file “${rel}” holds a NUL character, so it was not read`));
      return;
    }
    files.set(rel, text);
  };

  const tooMuch = () => new ReadError(`The course's files add up to more than the course version limit of ${mb(limits.maxTotalBytes)}; `
    + 'remove some files in Studio and export the course again.');

  const addStatic = async (path: string, entry: TarEntry) => {
    if (seenStatic.has(path)) return entry.body!.cancel();
    seenStatic.add(path);
    if (statics.length + 1 > caps.fileEntries) throw new ReadError(TOO_MANY_FILES);
    const ext = extension(path);
    let skipped: Skipped = null;
    if (ext === null || !ALLOWED_EXTENSIONS.has(ext)) skipped = 'type';
    else if (entry.size > limits.maxFileBytes) skipped = 'size';
    else if (entry.size === 0) skipped = 'empty';
    let chunks: Uint8Array<ArrayBuffer>[] = [];
    if (skipped) await entry.body!.cancel();
    else {
      const overTotal = () => kept + entry.size > limits.maxTotalBytes;
      if (entry.size >= MB && overTotal()) throw tooMuch(); // never buffer a big file past the limit
      chunks = await chunksOf(entry.body!);
      if (entry.size < MB && chunks.every((c) => c.every((b) => WHITESPACE.has(b)))) skipped = 'empty';
      else if (overTotal()) throw tooMuch();
    }
    statics.push({ path, size: entry.size, skipped });
    if (skipped) {
      report.push(line(`The file “${path}” ${SKIP_TEXT[skipped]}`));
      return;
    }
    kept += entry.size;
    blobs.set(blobKey('static', path), new Blob(chunks));
  };

  for await (const entry of readTar(await open(file, caps))) {
    const path = entry.type === 'file' ? cleanPath(entry.path) : null;
    if (path === null || !path.startsWith(prefix) || isOsJunk(path)) {
      await entry.body?.cancel();
      continue;
    }
    const rel = path.slice(prefix.length);
    if (rel.startsWith('static/')) await addStatic(rel.slice('static/'.length), entry);
    else if (isText(rel)) await addText(rel, entry);
    else await entry.body!.cancel();
  }
  statics.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { body: { files: Object.fromEntries(files), static: statics, apps: appList }, blobs };
}

/** Read the export in two passes (root, then extraction); nothing read is executed or rendered. */
export async function readExport(file: ArchiveSource, apps: (ArchiveSource & Blob)[], limits: ImportLimits,
                                 caps: ReadCaps = READ_CAPS): Promise<ReadResult> {
  try {
    const report: ReportLine[] = [];
    const { root, rejected } = await findRoot(file, caps);
    if (rejected) {
      report.push(line(`Archive entries with an unsafe path (“..”, a NUL character or over ${MAX_PATH} characters) were not read: ${rejected} ${rejected === 1 ? 'entry' : 'entries'}`));
    }
    const { body, blobs } = await extract(file, root, apps, limits, caps, report);
    const jsonBytes = new TextEncoder().encode(JSON.stringify(body)).length;
    if (jsonBytes > caps.jsonBytes) throw new ReadError(TOO_LARGE_JSON);
    return { body, blobs, report, jsonBytes };
  } catch (err) {
    if (err instanceof ReadError) throw err;
    if (err instanceof TarError) throw new ReadError(err.code === 'truncated' ? TRUNCATED : NOT_EXPORT);
    if (err instanceof DOMException) throw new ReadError(UNREADABLE); // the picked file changed or went away
    throw new ReadError(DAMAGED); // the gzip stream failed (a TypeError) or anything else
  }
}
