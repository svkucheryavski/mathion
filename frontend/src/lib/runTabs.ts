// The run page's tabs (R2 order) and the ?tab= address helpers (R1, R10).
// Overview is the address without ?tab (P18).

export type ActiveTab =
  | 'overview' | 'progress' | 'submissions' | 'roster'
  | 'groups' | 'mini-projects' | 'assets' | 'teachers';

export const RUN_TABS: readonly { key: ActiveTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'progress', label: 'Progress' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'roster', label: 'Roster' },
  { key: 'groups', label: 'Groups' },
  { key: 'mini-projects', label: 'Mini-projects' },
  { key: 'assets', label: 'Assets' },
  { key: 'teachers', label: 'Teachers' },
];

export function isTabKey(v: string | null): v is ActiveTab {
  return v !== null && RUN_TABS.some((t) => t.key === v);
}

export function rawTab(search: string): string | null {
  return new URLSearchParams(search).get('tab');
}

export function parseTab(search: string): ActiveTab {
  const v = rawTab(search);
  return isTabKey(v) ? v : 'overview';
}

function serialize(p: URLSearchParams): string {
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function withTab(search: string, tab: ActiveTab): string {
  const p = new URLSearchParams(search);
  if (tab === 'overview') p.delete('tab');
  else p.set('tab', tab);
  return serialize(p);
}

export function withoutTab(search: string): string {
  const p = new URLSearchParams(search);
  p.delete('tab');
  return serialize(p);
}

export function isRunPath(path: string): boolean {
  return /^\/teaching\/[^/]+\/runs\/[^/]+$/.test(path);
}
