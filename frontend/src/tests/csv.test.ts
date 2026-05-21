import { describe, it, expect } from 'vitest';
import { parseCsv } from '../lib/csv';

describe('parseCsv — error cases', () => {
  it('empty input → ok=false', () => {
    const r = parseCsv('', [], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Paste is empty.');
  });

  it('whitespace-only → ok=false', () => {
    const r = parseCsv('   \n  \r\n  ', [], []);
    expect(r.ok).toBe(false);
  });

  it('header promises emails but all blank → No email column', () => {
    const r = parseCsv('Name,Email,Group\nAlice,,A\nBob,,B', [], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('No email column found.');
  });
});

describe('parseCsv — header + delimiter detection', () => {
  it('detects comma delimiter and header row', () => {
    const r = parseCsv('Name,Email,Group\nAlice,a@x.com,G1', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.delimiter).toBe(',');
      expect(r.hasHeader).toBe(true);
      expect(r.rows[0].parsed).toEqual({ name: 'Alice', email: 'a@x.com', group: 'G1' });
    }
  });

  it('detects tab delimiter when tabs dominate', () => {
    const r = parseCsv('Name\tEmail\tGroup\nAlice\ta@x.com\tG1', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delimiter).toBe('\t');
  });

  it('tie between tab and comma → tab wins', () => {
    const r = parseCsv('a\tb,c', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delimiter).toBe('\t');
  });

  it('positional fallback: first cell looks like email → [email, group?]', () => {
    const r = parseCsv('a@x.com,G1\nb@x.com,G2', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hasHeader).toBe(false);
      expect(r.rows[0].parsed).toEqual({ name: null, email: 'a@x.com', group: 'G1' });
    }
  });

  it('positional fallback: first cell not email → [name, email, group?]', () => {
    const r = parseCsv('Alice,a@x.com,G1', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed).toEqual({ name: 'Alice', email: 'a@x.com', group: 'G1' });
  });

  it('single-cell paste: bare email lands as {email}', () => {
    const r = parseCsv('a@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed).toEqual({ name: null, email: 'a@x.com', group: null });
  });
});

describe('parseCsv — normalization', () => {
  it('strips leading BOM', () => {
    const r = parseCsv('﻿Email\na@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed.email).toBe('a@x.com');
  });

  it('normalizes CRLF and CR line endings', () => {
    const r = parseCsv('Email\r\na@x.com\rb@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it('drops blank lines', () => {
    const r = parseCsv('a@x.com\n\n\nb@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(2);
  });

  it('lowercases emails on output', () => {
    const r = parseCsv('A@X.COM', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].parsed.email).toBe('a@x.com');
  });
});

describe('parseCsv — validation, duplicates, already-enrolled, willCreateGroups', () => {
  it('marks invalid email rows', () => {
    const r = parseCsv('a@x.com\nnotanemail', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0].valid).toBe(true);
      expect(r.rows[1].valid).toBe(false);
      expect(r.invalidCount).toBe(1);
    }
  });

  it('flags in-paste duplicate as invalid; first occurrence stays valid', () => {
    const r = parseCsv('a@x.com\nA@x.com', [], []);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0].valid).toBe(true);
      expect(r.rows[1].valid).toBe(false);
      expect(r.rows[1].errors[0]).toMatch(/Duplicate in paste/);
      expect(r.duplicateInPasteCount).toBe(1);
    }
  });

  it('marks already-enrolled rows but keeps them valid', () => {
    const r = parseCsv('a@x.com\nb@x.com', [], ['a@x.com']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows[0].alreadyEnrolled).toBe(true);
      expect(r.rows[0].valid).toBe(true);
      expect(r.alreadyEnrolledEmails).toEqual(['a@x.com']);
    }
  });

  it('willCreateGroups lists only groups not in existing list (case-sensitive, trimmed)', () => {
    const r = parseCsv('a@x.com,Alpha\nb@x.com,Beta\nc@x.com,Beta', ['Alpha'], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.willCreateGroups).toEqual(['Beta']);
  });
});
