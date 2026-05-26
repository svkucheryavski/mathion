import { describe, it, expect } from 'vitest';

import { extractAssetRefs } from '../lib/extractAssetRefs';

// Parity contract: this file MUST mirror backend/mathion/markdown.py:52-68
// (extract_asset_filenames) exactly. Any divergence breaks the spec's
// "Reference resolution split" guarantee. See plan T5 + spec rev 3.5.

describe('extractAssetRefs — parity with backend/mathion/markdown.py:52-68', () => {
  it('extracts image syntax: ![alt](foo.pdf)', () => {
    expect(extractAssetRefs('![alt](foo.pdf)')).toEqual(new Set(['foo.pdf']));
  });

  it('extracts link syntax: [link](foo.pdf)', () => {
    expect(extractAssetRefs('[link](foo.pdf)')).toEqual(new Set(['foo.pdf']));
  });

  it('strips double-quoted title: ![alt](foo.pdf "Title") -> {foo.pdf}', () => {
    expect(extractAssetRefs('![alt](foo.pdf "Title")')).toEqual(new Set(['foo.pdf']));
  });

  it("strips single-quoted title: ![alt](foo.pdf 'Title') -> {foo.pdf}", () => {
    expect(extractAssetRefs("![alt](foo.pdf 'Title')")).toEqual(new Set(['foo.pdf']));
  });

  it('strips paren-delimited title: ![alt](foo.pdf (Title)) -> {foo.pdf}', () => {
    expect(extractAssetRefs('![alt](foo.pdf (Title))')).toEqual(new Set(['foo.pdf']));
  });

  it('skips http:// link target', () => {
    expect(extractAssetRefs('[x](http://example.com/foo.pdf)')).toEqual(new Set());
  });

  it('skips https:// link target', () => {
    expect(extractAssetRefs('[x](https://example.com/foo.pdf)')).toEqual(new Set());
  });

  it('skips mailto: link target', () => {
    expect(extractAssetRefs('[x](mailto:user@example.com)')).toEqual(new Set());
  });

  it('skips # anchor target', () => {
    expect(extractAssetRefs('[x](#anchor)')).toEqual(new Set());
  });

  it('case-sensitive prefix skip: [x](HTTP://foo.pdf) is captured (not skipped)', () => {
    // backend Python `str.startswith` with a tuple is case-sensitive — mixed-case
    // URLs are NOT skipped. Frontend must mirror.
    expect(extractAssetRefs('[x](HTTP://example.com/foo.pdf)')).toEqual(
      new Set(['HTTP://example.com/foo.pdf']),
    );
  });

  it('does NOT extract reference-style links', () => {
    // Backend's inline _LINK_REF requires `(` after `]` — reference-style
    // `[text][ref]` followed by `[ref]: foo.pdf` is not matched. Frontend
    // must mirror.
    const md = '[text][ref]\n\n[ref]: foo.pdf';
    expect(extractAssetRefs(md)).toEqual(new Set());
  });

  it('plain prose mentioning foo.pdf returns empty set', () => {
    expect(extractAssetRefs('See the file foo.pdf in the assets folder.')).toEqual(new Set());
  });

  it('substring overlap: [link](my-data.csv) does NOT include data.csv', () => {
    const result = extractAssetRefs('[link](my-data.csv)');
    expect(result.has('my-data.csv')).toBe(true);
    expect(result.has('data.csv')).toBe(false);
  });

  it('query string preserved: [link](foo.pdf?v=2)', () => {
    // Backend's resolve_asset_urls does plain string replace on full target,
    // so `foo.pdf?v=2` will never match an asset named `foo.pdf`. Spec
    // documents this as an Accepted gap.
    expect(extractAssetRefs('[link](foo.pdf?v=2)')).toEqual(new Set(['foo.pdf?v=2']));
  });

  it('fragment preserved: [link](foo.pdf#page=3)', () => {
    expect(extractAssetRefs('[link](foo.pdf#page=3)')).toEqual(new Set(['foo.pdf#page=3']));
  });

  it('escaped brackets are NOT respected: \\[x\\](foo.pdf) -> {foo.pdf}', () => {
    // Backend regex is naive — does not honor backslash escapes. Frontend
    // must mirror to avoid a "uses N" badge undercount.
    expect(extractAssetRefs('\\[x\\](foo.pdf)')).toEqual(new Set(['foo.pdf']));
  });

  it('angle-bracket targets captured verbatim: [x](<foo.pdf>) -> {<foo.pdf>}', () => {
    // Backend's [^)\s]+ target group captures `<foo.pdf>` literally. Frontend
    // must NOT strip the angle brackets.
    expect(extractAssetRefs('[x](<foo.pdf>)')).toEqual(new Set(['<foo.pdf>']));
  });

  it('empty input returns empty set', () => {
    expect(extractAssetRefs('')).toEqual(new Set());
  });

  it('multiple references in one document return the full set', () => {
    const md = `
# Heading
![img](one.pdf)
Some text.
[link](two.pdf)
[skip](http://example.com)
![also](three.png "Title")
`;
    expect(extractAssetRefs(md)).toEqual(new Set(['one.pdf', 'two.pdf', 'three.png']));
  });

  it('helper is stateless across calls (no leaked regex lastIndex)', () => {
    // Module-level /g regexes carry lastIndex; the helper must reset between
    // calls. A regression here would make the SECOND call return a subset.
    const md = '![a](x.pdf) ![b](y.pdf)';
    const a = extractAssetRefs(md);
    const b = extractAssetRefs(md);
    expect(a).toEqual(b);
    expect(a).toEqual(new Set(['x.pdf', 'y.pdf']));
  });
});
