import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { toasts, pushToast, clearToasts } from '../stores/toasts.svelte';

describe('stores/toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearToasts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pushToast adds a toast with default kind=info', () => {
    pushToast('Hello');
    expect(toasts.list).toHaveLength(1);
    expect(toasts.list[0].message).toBe('Hello');
    expect(toasts.list[0].kind).toBe('info');
  });

  it('pushToast accepts explicit kind', () => {
    pushToast('Boom', 'error');
    expect(toasts.list[0].kind).toBe('error');
  });

  it('toasts auto-dismiss after 5 s', () => {
    pushToast('bye');
    expect(toasts.list).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(toasts.list).toHaveLength(0);
  });

  it('clearToasts empties the list immediately', () => {
    pushToast('a');
    pushToast('b');
    clearToasts();
    expect(toasts.list).toHaveLength(0);
  });

  it('toast IDs are unique', () => {
    pushToast('a');
    pushToast('b');
    pushToast('c');
    const ids = toasts.list.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });
});
