import { describe, it, expect } from 'vitest';
import { blockPositions } from '../lib/blockNumbers';

describe('blockPositions (R13)', () => {
  it('numbers by list position, not by the stored order', () => {
    // Stored orders 1 and 3 (a block was deleted in between): B1, B2.
    const m = blockPositions([{ id: 10 }, { id: 30 }]);
    expect(m.get(10)).toBe(1);
    expect(m.get(30)).toBe(2);
  });
  it('a block not in the list has no number', () => {
    expect(blockPositions([]).get(5)).toBeUndefined();
  });
});
