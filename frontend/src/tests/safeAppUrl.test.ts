import { it, expect } from 'vitest';
import { safeAppUrl } from '../lib/safeAppUrl';

it('accepts https on an https page', () => {
  expect(safeAppUrl('https://example.com/app', 'https:')).toBe('https://example.com/app');
});

it('accepts http on an http (dev) page', () => {
  expect(safeAppUrl('http://localhost:8000/app', 'http:')).toBe('http://localhost:8000/app');
});

it('rejects http on an https page (mixed content)', () => {
  expect(safeAppUrl('http://example.com/app', 'https:')).toBeNull();
});

it('accepts https on an http page', () => {
  expect(safeAppUrl('https://example.com/app', 'http:')).toBe('https://example.com/app');
});

it('rejects everything safeIframeUrl rejects, regardless of page protocol', () => {
  expect(safeAppUrl('', 'https:')).toBeNull();
  expect(safeAppUrl('https://', 'https:')).toBeNull();        // no host
  expect(safeAppUrl('javascript:alert(1)', 'http:')).toBeNull();
  expect(safeAppUrl('not a url', 'https:')).toBeNull();
  expect(safeAppUrl(null, 'https:')).toBeNull();
});
