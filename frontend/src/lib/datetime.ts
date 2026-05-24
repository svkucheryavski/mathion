// Browser-local naive "YYYY-MM-DDTHH:MM" -> ISO 8601 UTC string ending in "Z".
// `new Date(naive)` parses naive strings as local per ECMA-262 §21.4.3.2;
// `.toISOString()` serializes as UTC ending in "Z". DST spring-forward
// non-existent times normalize forward by +1h (tested).
export function localInputToISO(value: string): string {
  return new Date(value).toISOString();
}

// Backend UTC ISO -> naive local "YYYY-MM-DDTHH:MM" for <input type="datetime-local">.
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Format a UTC ISO for human display in browser-local TZ: "YYYY-MM-DD HH:MM GMT+2".
export function formatLocalWithTz(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tz = localTzLabel().replace(/^\(|\)$/g, '');
  return `${base} ${tz}`;
}

// Browser-local TZ short offset, parenthesized for inline labels: "(GMT+2)" / "(UTC)".
// Pinned to `shortOffset` for cross-browser stability — the unpinned 'short'
// option returns locale-dependent abbreviations (Chrome "GMT+2" vs Safari "CEST")
// that are test-flaky.
export function localTzLabel(): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' }).formatToParts(new Date());
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
  return `(${tz})`;
}
