import { describe, it, expect } from 'vitest';
import { RUN_TABS, isTabKey, rawTab, parseTab, withTab, withoutTab, isRunPath } from '../lib/runTabs';

describe('runTabs (R1, R2, R10)', () => {
  it('RUN_TABS is the R2 order and names', () => {
    expect(RUN_TABS.map((t) => t.label)).toEqual(
      ['Overview', 'Progress', 'Submissions', 'Roster', 'Groups', 'Mini-projects', 'Assets', 'Teachers']);
    expect(RUN_TABS.map((t) => t.key)).toEqual(
      ['overview', 'progress', 'submissions', 'roster', 'groups', 'mini-projects', 'assets', 'teachers']);
  });

  it('isTabKey accepts only the eight keys', () => {
    expect(isTabKey('mini-projects')).toBe(true);
    expect(isTabKey('submission')).toBe(false);
    expect(isTabKey('')).toBe(false);
    expect(isTabKey(null)).toBe(false);
  });

  it('parseTab: missing or unknown → overview', () => {
    expect(parseTab('')).toBe('overview');
    expect(parseTab('?tab=progress')).toBe('progress');
    expect(parseTab('?x=1&tab=groups')).toBe('groups');
    expect(parseTab('?tab=nope')).toBe('overview');
    expect(rawTab('?tab=nope')).toBe('nope');
    expect(rawTab('?x=1')).toBeNull();
  });

  it('withTab keeps the other parameters; overview drops the parameter (P18)', () => {
    expect(withTab('', 'roster')).toBe('?tab=roster');
    expect(withTab('?x=1&tab=groups&y=2', 'assets')).toBe('?x=1&tab=assets&y=2');
    expect(withTab('?tab=groups', 'overview')).toBe('');
    expect(withTab('?x=1&tab=groups', 'overview')).toBe('?x=1');
  });

  it('withoutTab drops only tab', () => {
    expect(withoutTab('?tab=nope')).toBe('');
    expect(withoutTab('?a=1&tab=nope&b=2')).toBe('?a=1&b=2');
    expect(withoutTab('')).toBe('');
  });

  it('isRunPath matches only a run page', () => {
    expect(isRunPath('/teaching/algebra/runs/10')).toBe(true);
    expect(isRunPath('/teaching/algebra')).toBe(false);
    expect(isRunPath('/teaching/algebra/runs/10/x')).toBe(false);
    expect(isRunPath('/courses/algebra/runs/10')).toBe(false);
  });
});
