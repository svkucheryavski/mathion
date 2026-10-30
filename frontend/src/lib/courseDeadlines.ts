// D80 (user): students see ONE deadline per mini-project. The soft deadline
// is "the" deadline; the hard one is a hidden grace window -- "they should not
// know the submission will be accepted between soft and hard, otherwise
// nobody will respect soft deadlines". Teacher surfaces keep both.
//
// The rules follow the backend's submit gate (api/submissions.py):
// - a revision (major/minor) is bound only by the resubmission deadline: it is
//   the one shown, and submitting stays open until it; none set = no deadline;
// - otherwise (a first submission, or a fresh one after "rejected") the one
//   shown is the soft deadline, or the hard one when no soft one is set;
//   submitting stays open until the hard deadline, or always with none.
// A deadline at this very moment still counts (the gate rejects only after).
import type { LatestStatus } from './types';

type DeadlineFields = {
  hard_deadline: string | null;
  soft_deadline: string | null;
  resubmission_deadline: string | null;
  latest_status: LatestStatus;
};

export type StudentDeadline = { kind: 'due' | 'resubmit'; at: string; open: boolean };

export function studentDeadline(d: DeadlineFields, now: Date = new Date()): StudentDeadline | null {
  const t = now.getTime();
  const notPast = (iso: string) => new Date(iso).getTime() >= t;
  if (d.latest_status === 'major_revision' || d.latest_status === 'minor_revision') {
    const r = d.resubmission_deadline;
    return r === null ? null : { kind: 'resubmit', at: r, open: notPast(r) };
  }
  const shown = d.soft_deadline ?? d.hard_deadline;
  if (shown === null) return null;
  return { kind: 'due', at: shown, open: d.hard_deadline === null || notPast(d.hard_deadline) };
}

// The statuses with something still to submit; awaiting evaluation and
// accepted work have nothing due.
const TO_ACT: ReadonlySet<LatestStatus> = new Set<LatestStatus>([
  'not_submitted', 'rejected', 'pending_group_assignment', 'major_revision', 'minor_revision',
]);

export type ComingDeadline<T extends DeadlineFields = DeadlineFields> = {
  item: T;
  kind: 'due' | 'resubmit' | 'overdue';   // overdue: past its date, the window still open
  at: string;
  urgency: 'soon' | 'near' | null;        // 0-6 calendar days or overdue / 7-13 / 14+
};

// The course page's "Coming deadlines" card: one line per mini-project still
// to act on whose window is open, sorted by the shown date (overdue first).
export function comingDeadlines<T extends DeadlineFields & { block_order: number }>(
  items: T[], now: Date = new Date(),
): ComingDeadline<T>[] {
  const lines: ComingDeadline<T>[] = [];
  for (const item of items) {
    if (!TO_ACT.has(item.latest_status)) continue;
    const sd = studentDeadline(item, now);
    if (sd === null || !sd.open) continue;
    const overdue = new Date(sd.at).getTime() < now.getTime();
    const days = calendarDays(sd.at, now);
    lines.push({
      item,
      kind: overdue ? 'overdue' : sd.kind,
      at: sd.at,
      urgency: overdue || days <= 6 ? 'soon' : days <= 13 ? 'near' : null,
    });
  }
  const ms = (l: ComingDeadline<T>) => new Date(l.at).getTime();
  return lines.sort((a, b) => ms(a) - ms(b) || a.item.block_order - b.item.block_order);
}

// Calendar days from today to the date, in the viewer's local time.
// Math.round absorbs a daylight-saving day of 23 or 25 hours.
function calendarDays(iso: string, now: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(new Date(iso)) - day(now)) / 86_400_000);
}

// "today", "tomorrow", "in N days".
export function daysLeft(iso: string, now: Date = new Date()): string {
  const n = calendarDays(iso, now);
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}
