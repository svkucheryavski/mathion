// D22: the Users page's "Last active", as relative text. A time slightly in
// the future (clock skew between server and browser) reads "just now".
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

export function lastActiveText(iso: string | null, now: Date): string {
  if (iso === null) return 'never';
  const ms = now.getTime() - new Date(iso).getTime();
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return count(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return count(Math.floor(ms / HOUR), 'hour');
  if (ms < 2 * DAY) return 'yesterday';
  const days = Math.floor(ms / DAY);
  if (days < 30) return `${days} days ago`;
  if (days < 365) return count(Math.floor(days / 30), 'month');
  return count(Math.floor(days / 365), 'year');
}
