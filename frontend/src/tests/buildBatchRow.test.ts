import { describe, it, expect } from 'vitest';
import { buildBatchRow } from '../lib/buildBatchRow';
import type { CsvRow } from '../lib/csv';
import type { GroupResponse, RunStudentResponse } from '../lib/types';

const row = (over: Partial<CsvRow>): CsvRow => ({
  rowIndex: 1, raw: [], parsed: { name: null, email: '', group: null },
  valid: true, errors: [], alreadyEnrolled: false, ...over,
} as CsvRow);

const roster: RunStudentResponse[] = [
  { user_id: 1, user_email: 'a@x.com', user_full_name: null, group_id: 99 } as RunStudentResponse,
  { user_id: 2, user_email: 'b@x.com', user_full_name: null, group_id: null } as RunStudentResponse,
];

const groups: GroupResponse[] = [
  { id: 99, run_id: 10, name: 'Alpha', student_count: 1, is_disabled: false } as GroupResponse,
];

describe('buildBatchRow (F1=A)', () => {
  it('case 1: already-enrolled + empty group cell + has existing group → resolves current group name', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'a@x.com', group: null }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'a@x.com', group: 'Alpha' });
  });

  it('case 2: already-enrolled + empty group cell + null group → omits group field', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'b@x.com', group: null }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'b@x.com' });
    expect(Object.prototype.hasOwnProperty.call(r, 'group')).toBe(false);
  });

  it('case 3: brand-new + empty group cell → omits group field', () => {
    const r = buildBatchRow(
      row({ parsed: { name: 'Carol', email: 'c@x.com', group: null }, alreadyEnrolled: false }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'c@x.com', name: 'Carol' });
    expect(Object.prototype.hasOwnProperty.call(r, 'group')).toBe(false);
  });

  it('case 4: non-empty cell sent as-is (regardless of alreadyEnrolled)', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'a@x.com', group: 'Beta' }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'a@x.com', group: 'Beta' });
  });

  it('race fallback: already-enrolled email not in roster → omits group', () => {
    const r = buildBatchRow(
      row({ parsed: { name: null, email: 'gone@x.com', group: null }, alreadyEnrolled: true }),
      roster, groups,
    );
    expect(r).toEqual({ email: 'gone@x.com' });
    expect(Object.prototype.hasOwnProperty.call(r, 'group')).toBe(false);
  });
});
