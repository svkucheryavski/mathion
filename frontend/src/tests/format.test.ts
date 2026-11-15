import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../lib/format';

describe('lib/format', () => {
  describe('formatFileSize', () => {
    it('renders 0 bytes as "0 B"', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('renders sub-kB values as integer bytes', () => {
      expect(formatFileSize(1)).toBe('1 B');
      expect(formatFileSize(1023)).toBe('1023 B');
    });

    // The user's call (2026-11-12): sizes are 1024-based, like the limits.
    it('formatFileSize is 1024-based: kB from 1024 B, with 1 decimal', () => {
      expect(formatFileSize(1024)).toBe('1.0 kB');
      expect(formatFileSize(1536)).toBe('1.5 kB');
      expect(formatFileSize(1_048_524)).toBe('1023.9 kB');
      // Review t4-r1: a size that rounds to 1024.0 kB shows as MB.
      expect(formatFileSize(1_048_525)).toBe('1.0 MB');
      expect(formatFileSize(1024 * 1024 - 1)).toBe('1.0 MB');
    });

    it('formatFileSize is 1024-based: MB from 1,048,576 B, with 1 decimal', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(20 * 1024 * 1024)).toBe('20.0 MB');
      expect(formatFileSize(20.5 * 1_048_576)).toBe('20.5 MB');
      expect(formatFileSize(1023.9 * 1_048_576)).toBe('1023.9 MB');
    });

    // The user's call (2026-11-13): a site's storage reaches GB.
    it('formatFileSize is 1024-based: GB from 1024 MB, with 1 decimal', () => {
      expect(formatFileSize(1024 ** 3)).toBe('1.0 GB');
      expect(formatFileSize(3.5 * 1024 ** 3)).toBe('3.5 GB');
      expect(formatFileSize(3 * 1024 ** 3 + 512 * 1_048_576)).toBe('3.5 GB');
      // A size that rounds to 1024.0 MB shows as GB.
      expect(formatFileSize(1024 ** 3 - 1)).toBe('1.0 GB');
      expect(formatFileSize(2048 * 1024 ** 3)).toBe('2048.0 GB');
    });
  });
});
