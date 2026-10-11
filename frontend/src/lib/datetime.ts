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
// The offset comes from the TARGET date, not "now" — otherwise a winter deadline
// formatted in summer would show GMT+2 (the wall-clock offset belonging to the
// current moment) alongside the winter local hour, mismatching the two.
export function formatLocalWithTz(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tz = localTzLabel(d).replace(/^\(|\)$/g, '');
  return `${base} ${tz}`;
}

// Browser-local TZ short offset, parenthesized for inline labels: "(GMT+2)" / "(UTC)".
// Pinned to `shortOffset` for cross-browser stability — the unpinned 'short'
// option returns locale-dependent abbreviations (Chrome "GMT+2" vs Safari "CEST")
// that are test-flaky. The optional `date` arg lets callers (formatLocalWithTz)
// label a specific moment instead of "now" — important across DST boundaries.
export function localTzLabel(date?: Date): string {
  const target = date ?? new Date();
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' }).formatToParts(target);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
  return `(${tz})`;
}

// Fixed English month abbreviations: the short forms never follow the
// browser's locale (spec R12).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

// A UTC ISO deadline in browser-local time: "07 Aug 23:59".
export function formatShortDeadline(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// A calendar date "YYYY-MM-DD" (no time, no zone): "01 Sep 2026".
export function formatShortDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return `${pad2(d)} ${MONTHS[m - 1]} ${y}`;
}

// The Deadlines column header: the zone when every shown deadline shares one
// offset, "(local time)" when daylight saving splits them, bare otherwise.
export function deadlinesHeader(isos: string[]): string {
  const zones = new Set(isos.map((iso) => localTzLabel(new Date(iso))));
  if (zones.size === 0) return 'Deadlines';
  if (zones.size === 1) return `Deadlines ${[...zones][0]}`;
  return 'Deadlines (local time)';
}
