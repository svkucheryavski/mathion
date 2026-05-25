import { describe, it, expect } from 'vitest';
import { formatProgress, formatFileSize } from '../lib/format';

describe('lib/format', () => {
  it('formatProgress shows n/total', () => {
    expect(formatProgress(3, 10)).toBe('3 / 10');
  });

  it('formatProgress handles zero total', () => {
    expect(formatProgress(0, 0)).toBe('0 / 0');
  });

  describe('formatFileSize', () => {
    it('renders 0 bytes as "0 B"', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('renders sub-kB values as integer bytes', () => {
      expect(formatFileSize(1)).toBe('1 B');
      expect(formatFileSize(999)).toBe('999 B');
    });

    it('renders kB at 1000 B threshold with 1 decimal', () => {
      expect(formatFileSize(1000)).toBe('1.0 kB');
      expect(formatFileSize(1500)).toBe('1.5 kB');
      expect(formatFileSize(123456)).toBe('123.5 kB');
    });

    it('renders MB at 1_000_000 B threshold with 1 decimal', () => {
      expect(formatFileSize(1_000_000)).toBe('1.0 MB');
      expect(formatFileSize(5_500_000)).toBe('5.5 MB');
      expect(formatFileSize(20 * 1024 * 1024)).toBe('21.0 MB');
    });
  });
});
