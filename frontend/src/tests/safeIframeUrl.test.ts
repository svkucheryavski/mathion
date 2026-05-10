import { describe, it, expect } from 'vitest';
import { safeIframeUrl } from '../lib/safeIframeUrl';

describe('safeIframeUrl', () => {
  it('returns null for empty/whitespace/nullish input', () => {
    expect(safeIframeUrl('')).toBe(null);
    expect(safeIframeUrl('   ')).toBe(null);
    expect(safeIframeUrl(null)).toBe(null);
    expect(safeIframeUrl(undefined)).toBe(null);
  });

  it('accepts http URLs', () => {
    expect(safeIframeUrl('http://example.com/v')).toBe('http://example.com/v');
  });

  it('accepts https URLs', () => {
    expect(safeIframeUrl('https://www.youtube.com/embed/abc')).toBe(
      'https://www.youtube.com/embed/abc',
    );
  });

  it('rejects javascript: URIs (XSS prevention even inside an iframe src)', () => {
    expect(safeIframeUrl('javascript:alert(1)')).toBe(null);
  });

  it('rejects data: URIs', () => {
    expect(safeIframeUrl('data:text/html,<script>alert(1)</script>')).toBe(null);
  });

  it('rejects ftp:// and other non-http(s) schemes', () => {
    expect(safeIframeUrl('ftp://example.com/v')).toBe(null);
    expect(safeIframeUrl('file:///etc/passwd')).toBe(null);
  });

  it('rejects partial/malformed URLs (intermediate keystrokes)', () => {
    expect(safeIframeUrl('https://')).toBe(null);
    expect(safeIframeUrl('not a url')).toBe(null);
    expect(safeIframeUrl('://example.com')).toBe(null);
  });
});
