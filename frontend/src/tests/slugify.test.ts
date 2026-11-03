import { it, expect } from 'vitest';
import { slugFromName } from '../lib/slugify';

it('transliterates the Danish letters', () => {
  expect(slugFromName('Kemometri på dansk')).toBe('kemometri-paa-dansk');
  expect(slugFromName('Æble Østers Ål')).toBe('aeble-oesters-aal');
});

it('strips accents', () => {
  expect(slugFromName('Café Über')).toBe('cafe-uber');
});

it('joins words with single hyphens and trims them', () => {
  expect(slugFromName('  --Hello,  World!--  ')).toBe('hello-world');
});

it('gives an empty address for a name with no Latin letters or digits', () => {
  expect(slugFromName('!!!')).toBe('');
  expect(slugFromName('Ωμέγα')).toBe('');
});

it('cuts a long name to 80 and re-trims the hyphen the cut leaves', () => {
  const slug = slugFromName('a'.repeat(79) + ' ' + 'b'.repeat(40));
  expect(slug.length).toBeLessThanOrEqual(80);
  expect(slug).toBe('a'.repeat(79));
  expect(slugFromName('x'.repeat(120))).toBe('x'.repeat(80));
});
