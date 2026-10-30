// D80 (user): students see ONE deadline per mini-project. The soft deadline
// is "the" deadline; the hard one is a hidden grace window -- "they should not
// know the submission will be accepted between soft and hard, otherwise
// nobody will respect soft deadlines". Teacher surfaces keep both.
//
// D81: the server picks that one deadline (api/student_mini_projects.py
// `_student_deadline`, mirroring the submit gate) and sends it as `deadline`,
// `deadline_kind` and `deadline_open`; the student API never sends the hard
// one. This module only lists what is still to act on.
import type { LatestStatus, StudentDeadlineKind } from './types';

type DeadlineFields = {
  deadline: string | null;
  deadline_kind: StudentDeadlineKind | null;
  deadline_open: boolean;
  latest_status: LatestStatus;
};

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
    const at = item.deadline;
    if (at === null || item.deadline_kind === null || !item.deadline_open) continue;
    const overdue = new Date(at).getTime() < now.getTime();
    const days = calendarDays(at, now);
    lines.push({
      item,
      kind: overdue ? 'overdue' : item.deadline_kind,
      at,
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
