import { it, expect } from 'vitest';
import { lastActiveText } from '../lib/relativeTime';

const now = new Date('2026-11-03T12:00:00Z');
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

it('says never for an account that has not signed in', () => {
  expect(lastActiveText(null, now)).toBe('never');
});

it('says just now under a minute, and for a time slightly in the future', () => {
  expect(lastActiveText(ago(0), now)).toBe('just now');
  expect(lastActiveText(ago(59 * S), now)).toBe('just now');
  expect(lastActiveText(ago(-5 * S), now)).toBe('just now');
});

it('counts minutes, singular for one', () => {
  expect(lastActiveText(ago(M), now)).toBe('1 minute ago');
  expect(lastActiveText(ago(59 * M + 59 * S), now)).toBe('59 minutes ago');
});

it('counts hours under a day, singular for one', () => {
  expect(lastActiveText(ago(H), now)).toBe('1 hour ago');
  expect(lastActiveText(ago(23 * H + 59 * M), now)).toBe('23 hours ago');
});

it('says yesterday from 24 to 48 hours', () => {
  expect(lastActiveText(ago(D), now)).toBe('yesterday');
  expect(lastActiveText(ago(2 * D - S), now)).toBe('yesterday');
});

it('counts days under 30', () => {
  expect(lastActiveText(ago(2 * D), now)).toBe('2 days ago');
  expect(lastActiveText(ago(29 * D), now)).toBe('29 days ago');
});

it('counts months (days / 30, floored) under a year, singular for one', () => {
  expect(lastActiveText(ago(30 * D), now)).toBe('1 month ago');
  expect(lastActiveText(ago(59 * D), now)).toBe('1 month ago');
  expect(lastActiveText(ago(60 * D), now)).toBe('2 months ago');
  expect(lastActiveText(ago(364 * D), now)).toBe('12 months ago');
});

it('counts years from 365 days, singular for one', () => {
  expect(lastActiveText(ago(365 * D), now)).toBe('1 year ago');
  expect(lastActiveText(ago(3 * 365 * D), now)).toBe('3 years ago');
});
