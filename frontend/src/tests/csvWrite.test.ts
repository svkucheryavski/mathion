import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toCSV, downloadCSV, sanitizeTitle, type CsvColumn } from '../lib/csvWrite';

interface Row { name: string; n?: number; flag?: boolean }

const NAME_COL: CsvColumn<Row> = { header: 'name', value: (r) => r.name };
const N_COL: CsvColumn<Row> = { header: 'n', value: (r) => r.n };
const FLAG_COL: CsvColumn<Row> = { header: 'flag', value: (r) => r.flag };

describe('toCSV', () => {
  it('plain alphanumeric values → no quotes, no prefix', () => {
    const out = toCSV([{ name: 'alice' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\nalice');
  });

  it('embedded comma → quoted', () => {
    const out = toCSV([{ name: 'a,b' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\n"a,b"');
  });

  it('embedded double quote → quoted + doubled internal quotes', () => {
    const out = toCSV([{ name: 'a"b' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\n"a""b"');
  });

  it('embedded CR/LF → quoted', () => {
    const out = toCSV([{ name: 'a\nb' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\n"a\nb"');
  });

  it('leading = → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '=SUM(1)' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'=SUM(1)\"");
  });

  it('leading + → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '+1' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'+1\"");
  });

  it('leading - → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '-1' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'-1\"");
  });

  it('leading @ → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '@foo' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'@foo\"");
  });

  it('leading \\t → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '\tfoo' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'\tfoo\"");
  });

  it('leading \\r → APOSTROPHE-prefixed AND quoted', () => {
    const out = toCSV([{ name: '\rfoo' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe("name\n\"'\rfoo\"");
  });

  it('null/undefined → empty string', () => {
    const out = toCSV([{ name: 'x', n: undefined }], [NAME_COL, N_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name,n\nx,');
  });

  it('BOM prefix on by default', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { newline: '\n' });
    expect(out.charCodeAt(0)).toBe(0xFEFF);
  });

  it('BOM prefix off when bom: false', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out.charCodeAt(0)).not.toBe(0xFEFF);
  });

  it('newline default is \\r\\n', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { bom: false });
    expect(out).toBe('name\r\nx');
  });

  it('newline configurable via newline: \\n', () => {
    const out = toCSV([{ name: 'x' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name\nx');
  });

  it('Number serialization', () => {
    const out = toCSV([{ name: 'x', n: 42 }], [NAME_COL, N_COL], { bom: false, newline: '\n' });
    expect(out).toBe('name,n\nx,42');
  });

  it('Boolean serialization → unquoted literal true / false (no trigger chars)', () => {
    const out = toCSV(
      [{ name: 'x', flag: true }, { name: 'y', flag: false }],
      [NAME_COL, FLAG_COL],
      { bom: false, newline: '\n' },
    );
    expect(out).toBe('name,flag\nx,true\ny,false');
  });

  it('Header row first', () => {
    const out = toCSV([{ name: 'b' }, { name: 'a' }], [NAME_COL], { bom: false, newline: '\n' });
    expect(out.split('\n')[0]).toBe('name');
  });
});

describe('downloadCSV', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Blob with text/csv;charset=utf-8 and triggers an <a download> click', () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    let capturedHref = '';
    let capturedDownload = '';
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreateElement(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: vi.fn() });
        Object.defineProperty(el, 'href', {
          set(v: string) { capturedHref = v; },
          get() { return capturedHref; },
        });
        Object.defineProperty(el, 'download', {
          set(v: string) { capturedDownload = v; },
          get() { return capturedDownload; },
        });
      }
      return el;
    });

    downloadCSV('a,b\n1,2', 'test.csv');

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/csv;charset=utf-8' }),
    );
    expect(capturedDownload).toBe('test.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});

describe('sanitizeTitle', () => {
  it('keeps alphanumeric + space + dash + underscore', () => {
    expect(sanitizeTitle('Spring 2026', 'fallback')).toBe('Spring_2026');
  });

  it('replaces special chars with underscore', () => {
    expect(sanitizeTitle('a/b', 'fallback')).toBe('a_b');
  });

  it('all-stripped input falls back', () => {
    expect(sanitizeTitle('русский', 'run-7')).toBe('run-7');
    expect(sanitizeTitle('日本語', 'run-7')).toBe('run-7');
  });

  it('truncates to 60 chars and trims', () => {
    expect(sanitizeTitle('x'.repeat(120), 'fb').length).toBeLessThanOrEqual(60);
  });

  it('collapses underscore runs and trims edges', () => {
    expect(sanitizeTitle('___a___b___', 'fb')).toBe('a_b');
  });
});
