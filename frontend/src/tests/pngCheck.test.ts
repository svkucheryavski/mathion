import { describe, it, expect } from 'vitest';
import { checkPngBytes, crc32, PNG_MAX_BYTES } from '../lib/pngCheck';

// Branding D4-D6: the dialog's PNG check mirrors the server's check_png
// (backend/tests/test_png_check.py) case for case, so the dialog never
// previews a file Save refuses.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(kind: string | number[], data: number[], crc?: number): number[] {
  const k = typeof kind === 'string' ? ascii(kind) : kind;
  return [...u32(data.length), ...k, ...data, ...u32(crc ?? crc32(new Uint8Array([...k, ...data])))];
}
function ihdr({ width = 2, height = 1, depth = 8, colour = 6, compression = 0, filtering = 0, interlace = 0 } = {}) {
  return chunk('IHDR', [...u32(width), ...u32(height), depth, colour, compression, filtering, interlace]);
}
const idat = () => chunk('IDAT', [0x78, 0x9c, 0x63, 0x60, 0, 0, 0, 2, 0, 1]);
const iend = (data: number[] = []) => chunk('IEND', data);
const PLTE = chunk('PLTE', [0, 0, 0, 255, 255, 255]);
const png = (...chunks: number[][]) => new Uint8Array([...SIGNATURE, ...chunks.flat()]);
const VALID = png(ihdr(), idat(), iend());

const sized = (width: number, height: number) => png(ihdr({ width, height }), idat(), iend());

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new Uint8Array(ascii('123456789')))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array([]))).toBe(0);
  });
});

describe('checkPngBytes: what a browser can show (D5)', () => {
  it('a valid PNG gives its size', () => {
    expect(checkPngBytes(VALID, 'icon')).toEqual({ width: 2, height: 1, advice: expect.any(Array) });
  });

  it('bytes after IEND are ignored', () => {
    expect(checkPngBytes(new Uint8Array([...VALID, ...ascii('trailing junk')]), 'icon')).toMatchObject({ width: 2, height: 1 });
  });

  it('ancillary chunks are walked, and an unknown one is skipped', () => {
    expect(checkPngBytes(png(ihdr(), chunk('tEXt', ascii('Title\u0000Logo')), idat(), iend()), 'icon')).toMatchObject({ width: 2 });
    expect(checkPngBytes(png(ihdr(), chunk('abCd', ascii('anything')), idat(), iend()), 'icon')).toMatchObject({ width: 2 });
  });

  it.each([[1, 0], [16, 0], [8, 2], [16, 2], [1, 3], [8, 3], [8, 4], [16, 6]])(
    'depth %i with colour type %i is accepted', (depth, colour) => {
      const extra = colour === 3 ? [PLTE] : [];
      expect(checkPngBytes(png(ihdr({ depth, colour }), ...extra, idat(), iend()), 'icon')).toMatchObject({ width: 2, height: 1 });
    });

  it('an interlaced PNG is accepted', () => {
    expect(checkPngBytes(png(ihdr({ interlace: 1 }), idat(), iend()), 'icon')).toMatchObject({ width: 2 });
  });

  const IHDR_12 = chunk('IHDR', [...u32(2), ...u32(1), 8, 6, 0, 0]);
  it.each([
    ['a JPEG', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)])],
    ['an SVG', new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))],
    ['nothing', new Uint8Array([])],
    ['the signature alone', new Uint8Array(SIGNATURE)],
    ['a wrong IHDR CRC', png(chunk('IHDR', [...u32(2), ...u32(1), 8, 6, 0, 0, 0], 0), idat(), iend())],
    ['a wrong IDAT CRC', png(ihdr(), chunk('IDAT', [1, 2, 3], 1), iend())],
    ['no IEND', png(ihdr(), idat())],
    ['a truncated chunk', VALID.slice(0, -6)],
    ['width 0', png(ihdr({ width: 0 }), idat(), iend())],
    ['height 0', png(ihdr({ height: 0 }), idat(), iend())],
    ['width 2^31', png(ihdr({ width: 2 ** 31 }), idat(), iend())],
    ['depth 16 with a palette', png(ihdr({ depth: 16, colour: 3 }), idat(), iend())],
    ['depth 4 for truecolour', png(ihdr({ depth: 4, colour: 2 }), idat(), iend())],
    ['colour type 5', png(ihdr({ colour: 5 }), idat(), iend())],
    ["Apple's CgBI", png(chunk('CgBI', [0x50, 0, 0x20, 2]), ihdr(), idat(), iend())],
    ['a 12-byte IHDR', png(IHDR_12, idat(), iend())],
    ['no image data', png(ihdr(), iend())],
    ['a second IHDR', png(ihdr(), ihdr(), idat(), iend())],
    ['compression 1', png(ihdr({ compression: 1 }), idat(), iend())],
    ['filtering 1', png(ihdr({ filtering: 1 }), idat(), iend())],
    ['interlace 2', png(ihdr({ interlace: 2 }), idat(), iend())],
    ['a type that is not letters', png(ihdr(), chunk('ab1d', []), idat(), iend())],
    ['a type of control bytes', png(ihdr(), chunk([0, 1, 2, 3], []), idat(), iend())],
    ['an unknown critical chunk', png(ihdr(), chunk('ABCD', []), idat(), iend())],
    ['a palette image with no PLTE', png(ihdr({ colour: 3 }), idat(), iend())],
    ['IEND with data', png(ihdr(), idat(), iend(ascii('x')))],
    ['a huge chunk length', png(ihdr(), [...u32(0xfffffff0), ...ascii('IDAT')])],
  ])('refuses %s', (_label, bytes) => {
    expect(checkPngBytes(bytes, 'logo')).toEqual({ refused: 'The logo must be a PNG file.' });
    expect(checkPngBytes(bytes, 'icon')).toEqual({ refused: 'The tab icon must be a PNG file.' });
  });
});

describe('checkPngBytes: the caps (D4, D6)', () => {
  it('1 MB is 1,048,576 bytes; one byte more is refused first', () => {
    expect(PNG_MAX_BYTES).toBe(1_048_576);
    const pad = (n: number) => { const b = new Uint8Array(n); b.set(VALID); return b; };
    expect(checkPngBytes(pad(PNG_MAX_BYTES), 'logo')).toMatchObject({ width: 2 });
    expect(checkPngBytes(pad(PNG_MAX_BYTES + 1), 'logo')).toEqual({ refused: 'The logo can be at most 1 MB.' });
    expect(checkPngBytes(new Uint8Array(PNG_MAX_BYTES + 1), 'icon')).toEqual({ refused: 'The tab icon can be at most 1 MB.' });
  });

  it('the logo: at most 4096 px on a side and 4 million pixels in all', () => {
    const cap = { refused: 'The logo can be at most 4096 px on a side and 4 million pixels in all.' };
    expect(checkPngBytes(sized(4096, 976), 'logo')).toMatchObject({ width: 4096 });
    expect(checkPngBytes(sized(4097, 100), 'logo')).toEqual(cap);
    expect(checkPngBytes(sized(100, 4097), 'logo')).toEqual(cap);
    expect(checkPngBytes(sized(2000, 2000), 'logo')).toMatchObject({ width: 2000 });
    expect(checkPngBytes(sized(2000, 2001), 'logo')).toEqual(cap);
  });

  it('the tab icon: at most 1024 px on a side', () => {
    const cap = { refused: 'The tab icon can be at most 1024 px on a side.' };
    expect(checkPngBytes(sized(1024, 1024), 'icon')).toMatchObject({ width: 1024 });
    expect(checkPngBytes(sized(1025, 1024), 'icon')).toEqual(cap);
    expect(checkPngBytes(sized(1024, 1025), 'icon')).toEqual(cap);
  });
});

describe('checkPngBytes: advice that never blocks (D4, D6)', () => {
  const advice = (w: number, h: number, kind: 'logo' | 'icon') =>
    (checkPngBytes(sized(w, h), kind) as { advice: string[] }).advice;

  it('a logo under 56 px tall may look soft', () => {
    expect(advice(64, 16, 'logo')).toEqual(['This logo is 16 px tall, so it may look soft (56 px or more recommended).']);
    expect(advice(200, 56, 'logo')).toEqual([]);
  });

  it('a logo wider than 8:1 shows less than 20 px tall', () => {
    expect(advice(560, 70, 'logo')).toEqual([]);
    expect(advice(561, 70, 'logo')).toEqual(['This logo is very wide, so it will show less than 20 px tall.']);
    expect(advice(800, 40, 'logo')).toEqual([
      'This logo is 40 px tall, so it may look soft (56 px or more recommended).',
      'This logo is very wide, so it will show less than 20 px tall.',
    ]);
  });

  it('an icon whose shorter side is under 180 px may look soft', () => {
    expect(advice(16, 16, 'icon')).toEqual(['This icon is 16 px, so it may look soft in tabs and on phones (180 px or more recommended).']);
    expect(advice(180, 180, 'icon')).toEqual([]);
  });

  it("an icon that isn't square gets squeezed", () => {
    expect(advice(300, 200, 'icon')).toEqual(["This icon isn't square, so tabs and phones will squeeze it."]);
    expect(advice(200, 100, 'icon')).toEqual([
      'This icon is 100 px, so it may look soft in tabs and on phones (180 px or more recommended).',
      "This icon isn't square, so tabs and phones will squeeze it.",
    ]);
  });
});
