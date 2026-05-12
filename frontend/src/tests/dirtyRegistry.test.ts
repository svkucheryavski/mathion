import { describe, it, expect } from 'vitest';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type RegisteredTracker } from '../lib/dirtyRegistry.svelte';

// Fake tracker matching RegisteredTracker shape (readonly isDirty getter).
function fakeTracker(initial: boolean): RegisteredTracker & { setDirty(v: boolean): void } {
  let d = initial;
  return {
    get isDirty() { return d; },
    setDirty(v) { d = v; },
  };
}

describe('dirtyRegistry', () => {
  it('exports a symbol context key', () => {
    expect(typeof DIRTY_REGISTRY_KEY).toBe('symbol');
  });

  it('factory returns object with register / unregister / isAnyDirty', () => {
    const r = createDirtyRegistry();
    expect(typeof r.register).toBe('function');
    expect(typeof r.unregister).toBe('function');
    expect(typeof r.isAnyDirty).toBe('function');
  });

  it('empty registry returns isAnyDirty = false', () => {
    const r = createDirtyRegistry();
    expect(r.isAnyDirty()).toBe(false);
  });

  it('one clean tracker → isAnyDirty = false', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(false));
    expect(r.isAnyDirty()).toBe(false);
  });

  it('one dirty tracker → isAnyDirty = true', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(true));
    expect(r.isAnyDirty()).toBe(true);
  });

  it('multiple trackers OR correctly (any-dirty wins)', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(false));
    r.register(fakeTracker(false));
    r.register(fakeTracker(true));
    expect(r.isAnyDirty()).toBe(true);
  });

  it('reads tracker.isDirty getter on EACH iterate call (not cached)', () => {
    const r = createDirtyRegistry();
    const t = fakeTracker(false);
    r.register(t);
    expect(r.isAnyDirty()).toBe(false);
    t.setDirty(true);
    expect(r.isAnyDirty()).toBe(true);
    t.setDirty(false);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('unregister removes a tracker — register/unregister symmetric', () => {
    const r = createDirtyRegistry();
    const dirtyT = fakeTracker(true);
    r.register(dirtyT);
    expect(r.isAnyDirty()).toBe(true);
    r.unregister(dirtyT);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('unregister of unknown tracker is a no-op (does not throw)', () => {
    const r = createDirtyRegistry();
    const stranger = fakeTracker(true);
    expect(() => r.unregister(stranger)).not.toThrow();
    expect(r.isAnyDirty()).toBe(false);
  });

  it('add-then-remove sequence returns to clean', () => {
    const r = createDirtyRegistry();
    const t1 = fakeTracker(true);
    const t2 = fakeTracker(true);
    r.register(t1);
    r.register(t2);
    expect(r.isAnyDirty()).toBe(true);
    r.unregister(t1);
    expect(r.isAnyDirty()).toBe(true); // t2 still dirty
    r.unregister(t2);
    expect(r.isAnyDirty()).toBe(false);
  });
});
