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

it('spells out ß, ł and đ, which have no accent to drop', () => {
  expect(slugFromName('Straße')).toBe('strasse');
  expect(slugFromName('STRAẞE')).toBe('strasse');
  expect(slugFromName('Łódź')).toBe('lodz');
  expect(slugFromName('Đorđe')).toBe('dorde');
});

it('spells out every such letter wherever it comes, in either case', () => {
  expect(slugFromName('GROẞE STRAẞE')).toBe('grosse-strasse');
  expect(slugFromName('æÆ øØ åÅ ßẞ łŁ đĐ')).toBe('aeae-oeoe-aaaa-ssss-ll-dd');
});

it('spells out æ, ø and å with an accent on top too', () => {
  expect(slugFromName('\u01FD \u01FF \u01FB')).toBe('ae-oe-aa');
  expect(slugFromName('\u01FC \u01FE \u01FA')).toBe('ae-oe-aa');
  expect(slugFromName('a\u030A\u0301')).toBe('aa');
});

it('spells out œ, ı, þ, ð and ħ, which have no accent to drop either', () => {
  expect(slugFromName('Cœur Œuvre')).toBe('coeur-oeuvre');
  expect(slugFromName('Kıbrıs')).toBe('kibris');
  expect(slugFromName('Þór þing')).toBe('thor-thing');
  expect(slugFromName('Ðe ðað')).toBe('de-dad');
  expect(slugFromName('Ħal ħobż')).toBe('hal-hobz');
});

it('reads the Ångström sign and a decomposed å as the letter å', () => {
  expect(slugFromName('\u212Bngstr\u00F6m')).toBe('aangstrom');
  expect(slugFromName('pa\u030A dansk')).toBe('paa-dansk');
});
