import { describe, it, expect } from 'vitest';
import { ASSET_CAP, newestFirst, shownAssets } from '../lib/assetList';

type A = { id: number; uploaded_at: string; filename: string };
const a = (id: number, uploaded_at: string, filename = `f${id}.png`): A => ({ id, uploaded_at, filename });
// ids 1..n, upload time rising with id.
const many = (n: number, name = (i: number) => `pic-${i}.png`): A[] =>
  Array.from({ length: n }, (_, k) => a(k + 1, `2026-05-01T00:00:${String(k + 1).padStart(2, '0')}Z`, name(k + 1)));

describe('newestFirst', () => {
  it('orders by uploaded_at, newest first', () => {
    const list = [a(1, '2026-05-02T00:00:00Z'), a(2, '2026-05-01T00:00:00Z'), a(3, '2026-05-03T00:00:00Z')];
    expect(newestFirst(list).map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it('breaks equal times by the higher id first', () => {
    const t = '2026-05-01T00:00:00Z';
    expect(newestFirst([a(3, t), a(7, t), a(5, t)]).map((x) => x.id)).toEqual([7, 5, 3]);
  });

  it('sorts a missing or unreadable time as oldest, ties by id', () => {
    const list = [a(1, 'junk'), { id: 2, filename: 'x.png' } as unknown as A, a(3, '2026-05-01T00:00:00Z')];
    expect(newestFirst(list).map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it('does not mutate its input', () => {
    const list = [a(1, '2026-05-01T00:00:00Z'), a(2, '2026-05-02T00:00:00Z')];
    newestFirst(list);
    expect(list.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('shownAssets', () => {
  it('caps at 6 by default', () => expect(ASSET_CAP).toBe(6));

  it('empty search: the 6 newest and how many more', () => {
    const r = shownAssets(many(10), '');
    expect(r.rows.map((x) => x.id)).toEqual([10, 9, 8, 7, 6, 5]);
    expect(r.more).toBe(4);
  });

  it('empty search with fewer than the cap: all rows, none more', () => {
    const r = shownAssets(many(5), '   ');
    expect(r.rows).toHaveLength(5);
    expect(r.more).toBe(0);
  });

  it('matches the trimmed text anywhere in the name, ignoring case', () => {
    const list = [a(1, '2026-05-01T00:00:00Z', 'histogram.png'), a(2, '2026-05-02T00:00:00Z', 'Hist2.pdf'), a(3, '2026-05-03T00:00:00Z', 'bar.png')];
    const r = shownAssets(list, '  HIST ');
    expect(r.rows.map((x) => x.filename)).toEqual(['Hist2.pdf', 'histogram.png']);
    expect(r.more).toBe(0);
  });

  it('a search shows every match, beyond the cap', () => {
    const r = shownAssets(many(12), 'pic');
    expect(r.rows).toHaveLength(12);
    expect(r.more).toBe(0);
  });

  it('no match: no rows, none more', () => {
    expect(shownAssets(many(10), 'zebra')).toEqual({ rows: [], more: 0 });
  });
});
