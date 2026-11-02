import { describe, expect, it } from 'vitest';
import { comingDeadlines, daysLeft } from '../lib/courseDeadlines';
import type { LatestStatus, StudentMiniProjectListItem } from '../lib/types';

// D80/D81: students see ONE deadline per mini-project (the user's rule: the
// hard deadline is a hidden grace window). The server picks it (deadline,
// deadline_kind, deadline_open -- backend tests/test_student_one_deadline.py);
// the card lists what is still to act on. Dates are built in local time so
// the calendar-day rules hold in any test time zone.
const NOW = new Date(2026, 9, 30, 12, 0);           // 30 Oct 2026, 12:00 local
const at = (day: number, h = 23, m = 59) => new Date(2026, 9, day, h, m).toISOString(); // October `day` (32 = 1 Nov)

function mp(
  block_order: number,
  latest_status: LatestStatus,
  d: { at?: string | null; kind?: 'due' | 'resubmit' | null; open?: boolean } = {},
): StudentMiniProjectListItem {
  const deadline = d.at ?? null;
  return {
    mp_id: block_order * 10,
    block_id: block_order,
    block_slug: `b${block_order}`,
    block_order,
    block_title: `Block ${block_order}`,
    deadline,
    deadline_kind: d.kind !== undefined ? d.kind : deadline === null ? null : 'due',
    deadline_open: d.open ?? true,
    latest_status,
  };
}

describe('comingDeadlines (D80): the course page card', () => {
  it('a line per project still to act on, with its one date', () => {
    const lines = comingDeadlines([
      mp(1, 'not_submitted', { at: at(45) }),
      mp(2, 'rejected', { at: at(46) }),
      mp(3, 'pending_group_assignment', { at: at(47) }),
      mp(4, 'major_revision', { at: at(48), kind: 'resubmit' }),
      mp(5, 'minor_revision', {}),   // a revision with no resubmission deadline: no line
    ], NOW);
    expect(lines.map((l) => [l.item.block_order, l.kind, l.at])).toEqual([
      [1, 'due', at(45)], [2, 'due', at(46)], [3, 'due', at(47)], [4, 'resubmit', at(48)],
    ]);
  });

  it('past its date but still open: overdue; closed: gone', () => {
    const lines = comingDeadlines([
      mp(1, 'not_submitted', { at: at(29, 10), open: true }),
      mp(2, 'not_submitted', { at: at(28), open: false }),
      mp(3, 'minor_revision', { at: at(29), kind: 'resubmit', open: false }),
    ], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'overdue', at: at(29, 10), urgency: 'soon' });
  });

  it('submitted work (awaiting evaluation, accepted) drops off', () => {
    expect(comingDeadlines([
      mp(1, 'awaiting_evaluation', { at: at(40) }),
      mp(2, 'accepted', { at: at(40) }),
    ], NOW)).toEqual([]);
  });

  it('a deadline at this very moment is still due, not overdue', () => {
    expect(comingDeadlines([mp(1, 'not_submitted', { at: NOW.toISOString() })], NOW)[0].kind).toBe('due');
  });

  it('urgency by calendar days to the shown date: 0-6 soon, 7-13 near, 14+ none', () => {
    const u = (day: number) => comingDeadlines([mp(1, 'not_submitted', { at: at(day) })], NOW)[0].urgency;
    expect([u(30), u(36), u(37), u(43), u(44)]).toEqual(['soon', 'soon', 'near', 'near', null]);
  });

  it('sorts by the shown date, overdue first', () => {
    const lines = comingDeadlines([
      mp(1, 'not_submitted', { at: at(45) }),
      mp(2, 'not_submitted', { at: at(28) }),
      mp(3, 'minor_revision', { at: at(33), kind: 'resubmit' }),
    ], NOW);
    expect(lines.map((l) => l.item.block_order)).toEqual([2, 3, 1]);
  });
});

describe('daysLeft (D80)', () => {
  it('counts calendar days: today, tomorrow, in N days', () => {
    expect(daysLeft(at(30, 23, 59), NOW)).toBe('today');
    expect(daysLeft(at(30, 12, 0), NOW)).toBe('today');
    expect(daysLeft(at(31, 0, 1), NOW)).toBe('tomorrow');
    expect(daysLeft(at(35, 9, 0), NOW)).toBe('in 5 days');
  });

  it('counts calendar days across a daylight-saving change', () => {
    // Spring forward (29 Mar 2026 in Europe): Saturday noon to Monday 09:00 is
    // 45 hours but 2 calendar days; autumn back (25 Oct): 26 hours, 1 day.
    expect(daysLeft(new Date(2026, 2, 30, 9, 0).toISOString(), new Date(2026, 2, 28, 12, 0))).toBe('in 2 days');
    expect(daysLeft(new Date(2026, 9, 25, 23, 0).toISOString(), new Date(2026, 9, 24, 22, 0))).toBe('tomorrow');
    expect(daysLeft(new Date(2026, 9, 26, 1, 0).toISOString(), new Date(2026, 9, 24, 23, 0))).toBe('in 2 days');
  });
});
