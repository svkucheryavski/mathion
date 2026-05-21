import { describe, it, expect } from 'vitest';
import { runStatus } from '../lib/runStatus';

describe('runStatus', () => {
  it('returns draft when !is_published regardless of dates', () => {
    const r = { is_published: false, start_date: '2026-01-01', end_date: '2026-12-31' };
    expect(runStatus(r, new Date('2026-06-01T12:00:00'))).toBe('draft');
  });

  it('returns upcoming when now is before start_date (local midnight)', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-09T23:59:59'))).toBe('upcoming');
  });

  it('returns active on the start date at local midnight', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-10T00:00:00'))).toBe('active');
  });

  it('returns active mid-window', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-15T08:00:00'))).toBe('active');
  });

  it('returns active on the end date at 23:59:59 local', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    expect(runStatus(r, new Date('2026-06-20T23:59:59'))).toBe('active');
  });

  it('returns ended one second past the end_date local end-of-day', () => {
    const r = { is_published: true, start_date: '2026-06-10', end_date: '2026-06-20' };
    // 2026-06-21T00:00:00 local is just past end-of-day on 2026-06-20.
    expect(runStatus(r, new Date('2026-06-21T00:00:00'))).toBe('ended');
  });
});
