import { describe, it, expect } from 'vitest';
import { labelFor } from '../lib/labelFor';

describe('labelFor', () => {
  it('returns title when non-empty', () => {
    expect(labelFor('Linear Algebra', 'lin-alg')).toBe('Linear Algebra');
  });

  it('falls back to slug when title is empty', () => {
    expect(labelFor('', 'intro-1')).toBe('intro-1');
  });

  it('falls back to slug when title is whitespace-only', () => {
    expect(labelFor('   ', 'intro-1')).toBe('intro-1');
  });

  it('falls back to provided positional fallback when both empty', () => {
    expect(labelFor('', '', 'block 3')).toBe('block 3');
  });

  it('falls back to provided positional fallback when both whitespace', () => {
    expect(labelFor('  ', '  ', 'item 5')).toBe('item 5');
  });

  it('returns "untitled" when all empty and no fallback supplied', () => {
    expect(labelFor('', '')).toBe('untitled');
  });

  it('handles null inputs gracefully', () => {
    expect(labelFor(null, null, 'sequence 2')).toBe('sequence 2');
  });

  it('handles undefined inputs gracefully', () => {
    expect(labelFor(undefined, undefined)).toBe('untitled');
  });

  it('trims surrounding whitespace from title', () => {
    expect(labelFor('  Vectors  ', '')).toBe('Vectors');
  });

  it('trims surrounding whitespace from slug', () => {
    expect(labelFor('', '  intro-1  ')).toBe('intro-1');
  });

  it('item-flavored case: empty title, non-empty slug, item fallback', () => {
    expect(labelFor('  ', 'worked-example-3', 'item 5')).toBe('worked-example-3');
  });

  it('whitespace-only fallback also falls through to "untitled"', () => {
    expect(labelFor('', '', '   ')).toBe('untitled');
  });
});
