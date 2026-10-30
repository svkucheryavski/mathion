import { describe, expect, it } from 'vitest';
import { comingDeadlines, daysLeft, studentDeadline } from '../lib/courseDeadlines';
import type { LatestStatus, StudentMiniProjectListItem } from '../lib/types';

// D80: students see ONE deadline per mini-project (the user's rule: the hard
// deadline is a hidden grace window). Dates are built in local time so the
// calendar-day rules hold in any test time zone.
const NOW = new Date(2026, 9, 30, 12, 0);           // 30 Oct 2026, 12:00 local
const at = (day: number, h = 23, m = 59) => new Date(2026, 9, day, h, m).toISOString(); // October `day` (32 = 1 Nov)

function mp(
  block_order: number,
  latest_status: LatestStatus,
  d: { hard?: string | null; soft?: string | null; resub?: string | null } = {},
): StudentMiniProjectListItem {
  return {
    mp_id: block_order * 10,
    block_id: block_order,
    block_slug: `b${block_order}`,
    block_order,
    block_title: `Block ${block_order}`,
    hard_deadline: d.hard ?? null,
    soft_deadline: d.soft ?? null,
    resubmission_deadline: d.resub ?? null,
    latest_status,
  };
}

describe('studentDeadline (D80): the one deadline a student sees', () => {
  it('the soft deadline when set; open until the hidden hard one', () => {
    expect(studentDeadline(mp(1, 'not_submitted', { hard: at(40), soft: at(35) }), NOW)).toEqual({ kind: 'due', at: at(35), open: true });
    expect(studentDeadline(mp(1, 'not_submitted', { hard: at(40), soft: at(29) }), NOW)).toEqual({ kind: 'due', at: at(29), open: true });
    expect(studentDeadline(mp(1, 'not_submitted', { hard: at(29), soft: at(28) }), NOW)).toEqual({ kind: 'due', at: at(28), open: false });
  });

  it('the hard deadline only when no soft one is set', () => {
    expect(studentDeadline(mp(1, 'rejected', { hard: at(40) }), NOW)).toEqual({ kind: 'due', at: at(40), open: true });
    expect(studentDeadline(mp(1, 'rejected', { hard: at(29) }), NOW)).toEqual({ kind: 'due', at: at(29), open: false });
  });

  it('a soft deadline with no hard one never closes', () => {
    expect(studentDeadline(mp(1, 'not_submitted', { soft: at(20) }), NOW)).toEqual({ kind: 'due', at: at(20), open: true });
  });

  it('a revision: the resubmission deadline, open until it; none set = no deadline', () => {
    expect(studentDeadline(mp(1, 'major_revision', { hard: at(29), soft: at(28), resub: at(33) }), NOW)).toEqual({ kind: 'resubmit', at: at(33), open: true });
    expect(studentDeadline(mp(1, 'minor_revision', { resub: at(29) }), NOW)).toEqual({ kind: 'resubmit', at: at(29), open: false });
    expect(studentDeadline(mp(1, 'minor_revision', { hard: at(40), soft: at(38) }), NOW)).toBeNull();
  });

  it('a window closing at this very moment is still open (the gate refuses only after)', () => {
    const now = NOW.toISOString();
    expect(studentDeadline(mp(1, 'not_submitted', { hard: now, soft: at(28) }), NOW)!.open).toBe(true);
    expect(studentDeadline(mp(1, 'major_revision', { resub: now }), NOW)!.open).toBe(true);
  });

  it('no date at all = no deadline', () => {
    expect(studentDeadline(mp(1, 'not_submitted', {}), NOW)).toBeNull();
  });
});

describe('comingDeadlines (D80): the course page card', () => {
  it('a line per project still to act on, with its one date', () => {
    const lines = comingDeadlines([
      mp(1, 'not_submitted', { hard: at(50), soft: at(45) }),
      mp(2, 'rejected', { hard: at(46) }),
      mp(3, 'pending_group_assignment', { soft: at(47) }),
      mp(4, 'major_revision', { hard: at(29), resub: at(48) }),
      mp(5, 'minor_revision', { hard: at(50), soft: at(45) }),   // a revision with no resubmission deadline: no line
    ], NOW);
    expect(lines.map((l) => [l.item.block_order, l.kind, l.at])).toEqual([
      [1, 'due', at(45)], [2, 'due', at(46)], [3, 'due', at(47)], [4, 'resubmit', at(48)],
    ]);
  });

  it('past its date but still open: overdue; closed: gone', () => {
    const lines = comingDeadlines([
      mp(1, 'not_submitted', { hard: at(40), soft: at(29, 10) }),
      mp(2, 'not_submitted', { hard: at(29), soft: at(28) }),
      mp(3, 'minor_revision', { resub: at(29) }),
    ], NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'overdue', at: at(29, 10), urgency: 'soon' });
  });

  it('submitted work (awaiting evaluation, accepted) drops off', () => {
    expect(comingDeadlines([
      mp(1, 'awaiting_evaluation', { hard: at(40) }),
      mp(2, 'accepted', { hard: at(40), resub: at(41) }),
    ], NOW)).toEqual([]);
  });

  it('a deadline at this very moment is still due, not overdue', () => {
    expect(comingDeadlines([mp(1, 'not_submitted', { soft: NOW.toISOString() })], NOW)[0].kind).toBe('due');
  });

  it('urgency by calendar days to the shown date: 0-6 soon, 7-13 near, 14+ none', () => {
    const u = (day: number) => comingDeadlines([mp(1, 'not_submitted', { soft: at(day) })], NOW)[0].urgency;
    expect([u(30), u(36), u(37), u(43), u(44)]).toEqual(['soon', 'soon', 'near', 'near', null]);
  });

  it('sorts by the shown date, overdue first', () => {
    const lines = comingDeadlines([
      mp(1, 'not_submitted', { soft: at(45) }),
      mp(2, 'not_submitted', { hard: at(50), soft: at(28) }),
      mp(3, 'minor_revision', { resub: at(33) }),
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
