import { describe, it, expect, afterEach } from 'vitest';
import { reportSaveFailure } from '../lib/itemBody';
import { toasts, clearToasts } from '../stores/toasts.svelte';

afterEach(() => clearToasts());

describe('reportSaveFailure (fix-pass review)', () => {
  it('an offline save toasts OFFLINE_MESSAGE', () => {
    reportSaveFailure(new TypeError('Failed to fetch'), 1, () => false);
    expect(toasts.list.map((t) => t.message)).toEqual(['Could not reach server. Check your connection.']);
  });
  it('any other error toasts Save failed', () => {
    reportSaveFailure(new Error('x'), 1, () => false);
    expect(toasts.list.map((t) => t.message)).toEqual(['Save failed']);
  });
});
