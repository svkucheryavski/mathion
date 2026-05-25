import { describe, it, expect, beforeAll } from 'vitest';
import { localInputToISO, isoToLocalInput, formatLocalWithTz, localTzLabel } from '../lib/datetime';

// TZ pinned to Europe/Copenhagen via package.json scripts (TZ=Europe/Copenhagen
// prepended to vitest). Node caches the host TZ at process start, so a
// setupFiles script is too late — we set it on the npm command line instead.
//
// In summer, Europe/Copenhagen is GMT+2 (CEST); in winter GMT+1 (CET).

beforeAll(() => {
  // `process` is a Node global; type via globalThis so svelte-check passes
  // without pulling @types/node.
  const tz = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.TZ;
  if (tz !== 'Europe/Copenhagen') {
    throw new Error(
      `TZ pin required: expected Europe/Copenhagen, got ${tz ?? 'unset'}. ` +
        'Run via npm test (which prepends TZ=...) not bare npx vitest.',
    );
  }
});

describe('localInputToISO', () => {
  it('converts local naive string to UTC Z ISO (summer / CEST)', () => {
    // 2026-06-07 23:59 CEST = 21:59 UTC
    expect(localInputToISO('2026-06-07T23:59')).toBe('2026-06-07T21:59:00.000Z');
  });

  it('converts local naive string to UTC Z ISO (winter / CET)', () => {
    // 2026-01-15 12:00 CET = 11:00 UTC
    expect(localInputToISO('2026-01-15T12:00')).toBe('2026-01-15T11:00:00.000Z');
  });

  it('DST spring-forward normalizes non-existent local times +1h per ECMA-262', () => {
    // 2026-03-29 02:30 doesn't exist in Europe/Copenhagen (clocks jump 02:00 -> 03:00).
    // Per ECMA-262 §21.4.3.2, parsed as 03:30 local = 01:30 UTC.
    expect(localInputToISO('2026-03-29T02:30')).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('isoToLocalInput', () => {
  it('round-trips ISO UTC back to naive local input string (summer)', () => {
    expect(isoToLocalInput('2026-06-07T21:59:00Z')).toBe('2026-06-07T23:59');
  });

  it('round-trips winter UTC', () => {
    expect(isoToLocalInput('2026-01-15T11:00:00Z')).toBe('2026-01-15T12:00');
  });
});

describe('formatLocalWithTz', () => {
  it('formats UTC ISO with browser-local label (summer / CEST = GMT+2)', () => {
    const out = formatLocalWithTz('2026-06-07T21:59:00Z');
    expect(out).toMatch(/2026-06-07/);
    expect(out).toMatch(/23:59/);
    expect(out).toMatch(/GMT\+2/);
  });

  it('formats winter UTC ISO with GMT+1 label regardless of current season', () => {
    // Regression: formatLocalWithTz must use the TARGET date's offset, not the
    // current Date's offset. A winter deadline shown in summer must still
    // render as GMT+1 (CET) — otherwise the displayed wall-clock time would
    // mismatch the labelled offset.
    const out = formatLocalWithTz('2026-01-15T11:00:00Z');
    expect(out).toMatch(/2026-01-15/);
    expect(out).toMatch(/12:00/);
    expect(out).toMatch(/GMT\+1/);
  });
});

describe('localTzLabel', () => {
  it('returns a short-offset label string for the current moment', () => {
    // shape "(GMT+2)" or "(UTC)" depending on TZ; pinned to Copenhagen so
    // GMT+1 (winter) or GMT+2 (summer).
    const label = localTzLabel();
    expect(label).toMatch(/^\(GMT[+-]?\d?\)$|^\(UTC\)$/);
  });

  it('accepts a Date arg and uses ITS offset (so winter dates label as GMT+1)', () => {
    expect(localTzLabel(new Date('2026-01-15T11:00:00Z'))).toMatch(/\(GMT\+1\)/);
    expect(localTzLabel(new Date('2026-06-07T21:59:00Z'))).toMatch(/\(GMT\+2\)/);
  });
});
