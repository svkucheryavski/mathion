// Branding D4-D6: the image dialogs' PNG check, a mirror of the server's
// backend/mathion/png_check.py, so the dialog never previews a file Save
// refuses. Without decoding: the signature, an IHDR chunk first and valid,
// every chunk walked by its length with a valid CRC, image data, up to IEND.
// Then the size caps, then the advice that never blocks.

/** 1 MB, as the server counts it (site_settings.MB). */
export const PNG_MAX_BYTES = 1_048_576;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_SIDE = 2 ** 31 - 1; // PNG's own limit
// The critical chunks a browser knows; another critical chunk (an upper-case
// first letter) means the browser can't show the image.
const CRITICAL = ['IHDR', 'PLTE', 'IDAT', 'IEND'];
// Colour type -> the bit depths PNG allows for it.
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

// D4, D6: the item's words, the longest side, the most pixels, and the cap's sentence.
const ITEMS = {
  logo: { item: 'logo', side: 4096, pixels: 4_000_000 as number | null,
    cap: 'The logo can be at most 4096 px on a side and 4 million pixels in all.' },
  icon: { item: 'tab icon', side: 1024, pixels: null as number | null,
    cap: 'The tab icon can be at most 1024 px on a side.' },
};

let table: Uint32Array | null = null;

/** CRC-32 (the PNG and zlib polynomial). */
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const isLetter = (b: number) => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);

/** D5: the PNG's width and height, or null when a browser can't show it. */
function pngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 8 || SIGNATURE.some((b, i) => data[i] !== b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 8, first = true, imageData = false, palette = false, colour = 0;
  let size = { width: 0, height: 0 };
  for (;;) {
    if (pos + 8 > data.length) return null;
    const length = view.getUint32(pos);
    const end = pos + 12 + length;
    if (length > MAX_SIDE || end > data.length) return null;
    const typeBytes = data.subarray(pos + 4, pos + 8);
    if (![...typeBytes].every(isLetter)) return null;
    const kind = String.fromCharCode(...typeBytes);
    if (typeBytes[0] < 0x61 && !CRITICAL.includes(kind)) return null;
    if (crc32(data.subarray(pos + 4, end - 4)) !== view.getUint32(end - 4)) return null;
    if (first) {
      if (kind !== 'IHDR' || length !== 13) return null;
      const width = view.getUint32(pos + 8), height = view.getUint32(pos + 12);
      const [depth, col, compression, filtering, interlace] = data.subarray(pos + 16, pos + 21);
      if (width < 1 || width > MAX_SIDE || height < 1 || height > MAX_SIDE) return null;
      if (!(DEPTHS[col] ?? []).includes(depth) || compression || filtering || interlace > 1) return null;
      size = { width, height };
      colour = col;
      first = false;
    } else if (kind === 'IHDR') {
      return null;
    } else if (kind === 'PLTE') {
      palette = true;
    } else if (kind === 'IDAT') {
      if (colour === 3 && !palette) return null;
      imageData = true;
    } else if (kind === 'IEND') {
      return imageData && length === 0 ? size : null;
    }
    pos = end;
  }
}

/**
 * The dialog's whole check of a chosen file's bytes, in the server's order:
 * the 1 MB cap, D5's PNG check, the pixel caps; then D4's or D6's advice.
 */
export function checkPngBytes(
  bytes: Uint8Array, kind: 'logo' | 'icon',
): { width: number; height: number; advice: string[] } | { refused: string } {
  const it = ITEMS[kind];
  if (bytes.length > PNG_MAX_BYTES) return { refused: `The ${it.item} can be at most 1 MB.` };
  const size = pngSize(bytes);
  if (!size) return { refused: `The ${it.item} must be a PNG file.` };
  const { width, height } = size;
  if (width > it.side || height > it.side || (it.pixels !== null && width * height > it.pixels)) {
    return { refused: it.cap };
  }
  const advice: string[] = [];
  if (kind === 'logo') {
    if (height < 56) advice.push(`This logo is ${height} px tall, so it may look soft (56 px or more recommended).`);
    if (width > 8 * height) advice.push('This logo is very wide, so it will show less than 20 px tall.');
  } else {
    const shorter = Math.min(width, height);
    if (shorter < 180) advice.push(`This icon is ${shorter} px, so it may look soft in tabs and on phones (180 px or more recommended).`);
    if (width !== height) advice.push("This icon isn't square, so tabs and phones will squeeze it.");
  }
  return { width, height, advice };
}
