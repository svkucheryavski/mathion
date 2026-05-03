import { describe, it, expect } from 'vitest';
import { formatProgress } from '../lib/format';

describe('lib/format', () => {
  it('formatProgress shows n/total', () => {
    expect(formatProgress(3, 10)).toBe('3 / 10');
  });

  it('formatProgress handles zero total', () => {
    expect(formatProgress(0, 0)).toBe('0 / 0');
  });
});
