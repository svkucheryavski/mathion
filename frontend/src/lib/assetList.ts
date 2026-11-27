import type { AssetItem } from './assetContext';

export const ASSET_CAP = 8;

// A missing or unreadable time sorts as oldest.
function time(item: Pick<AssetItem, 'uploaded_at'>): number {
  const t = Date.parse(item.uploaded_at);
  return Number.isNaN(t) ? -Infinity : t;
}

export function newestFirst<T extends Pick<AssetItem, 'id' | 'uploaded_at'>>(list: T[]): T[] {
  return [...list].sort((x, y) => {
    const tx = time(x);
    const ty = time(y);
    if (tx !== ty) return tx < ty ? 1 : -1;
    return y.id - x.id;
  });
}

// Empty search: the `cap` newest and how many more; otherwise every match, newest first.
export function shownAssets<T extends Pick<AssetItem, 'id' | 'uploaded_at' | 'filename'>>(
  list: T[],
  query: string,
  cap = ASSET_CAP,
): { rows: T[]; more: number } {
  const sorted = newestFirst(list);
  const q = query.trim().toLowerCase();
  if (q === '') return { rows: sorted.slice(0, cap), more: Math.max(0, sorted.length - cap) };
  return { rows: sorted.filter((a) => a.filename.toLowerCase().includes(q)), more: 0 };
}
