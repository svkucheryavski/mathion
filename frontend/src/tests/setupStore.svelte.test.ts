import { it, expect, beforeEach, afterEach, describe, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import { SetupStore } from '../lib/setupStore.svelte';
import {
  entryMove, markFor, setMark, clearMark, keepSignIn, setupGo, setupSaved, setupSkip, SETUP_MARK, type PanelSetup,
} from '../lib/setup';

// Set up D2, D3a, D13: the shell's one copy of the wizard's state.

function state(over: Partial<PanelSetup> = {}): PanelSetup {
  return {
    wizard_on: true, step: 1,
    steps: [0, 1, 2, 3].map(() => ({ passed: false, done: false, reason: null })),
    course: null, course_without_admin: null, email_set_up: false, pin_minutes: 10, defaults_in_use: true,
    ...over,
  };
}

type Pending = { resolve: (v: PanelSetup) => void; reject: (e: unknown) => void };
function deferred(): { promise: Promise<PanelSetup> } & Pending {
  let resolve!: (v: PanelSetup) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<PanelSetup>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('SetupStore', () => {
  let gets: ReturnType<typeof deferred>[];
  let onAuth: ReturnType<typeof vi.fn>;
  let store: SetupStore;

  beforeEach(() => {
    gets = [];
    vi.spyOn(api, 'get').mockImplementation((() => {
      const d = deferred();
      gets.push(d);
      return d.promise;
    }) as typeof api.get);
    onAuth = vi.fn();
    store = new SetupStore('T', onAuth);
  });
  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads the panel endpoint, without the app-wide sign-in redirect', async () => {
    void store.read();
    expect(api.get).toHaveBeenCalledWith('/api/superuser/T/setup', { skipAuthRedirect: true });
  });

  it('drops an older answer', async () => {
    const first = store.read();
    const second = store.read();
    gets[1].resolve(state({ step: 3 }));
    await settle();
    gets[0].resolve(state({ step: 2 }));
    expect(await first).toBeNull();
    expect(await second).toMatchObject({ step: 3 });
    expect(store.state?.step).toBe(3);
  });

  it('read waits for a running write', async () => {
    const w = deferred();
    const written = store.write(() => w.promise);
    expect(store.busy).toBe(true);
    const read = store.read();
    await settle();
    expect(gets).toHaveLength(0);
    w.resolve(state({ step: 2 }));
    expect(await written).toMatchObject({ step: 2 });
    expect(store.busy).toBe(false);
    await settle();
    expect(gets).toHaveLength(1);
    gets[0].resolve(state({ step: 4 }));
    expect((await read)?.step).toBe(4);
  });

  it('writes run one at a time, and a failed one throws', async () => {
    const a = deferred();
    const b = deferred();
    let second = false;
    const one = store.write(() => a.promise);
    const two = store.write(() => { second = true; return b.promise; });
    await settle();
    expect(second).toBe(false);
    a.reject(new ApiError(422, 'The step must be from 1 to 4.'));
    await expect(one).rejects.toBeInstanceOf(ApiError);
    await settle();
    expect(second).toBe(true);
    b.resolve(state({ step: 3 }));
    await two;
    expect(store.state?.step).toBe(3);
    expect(onAuth).not.toHaveBeenCalled();   // the caller shows a write's error
  });

  it('failed read keeps last good state', async () => {
    const ok = store.read();
    gets[0].resolve(state({ step: 2 }));
    await ok;
    const bad = store.read();
    gets[1].reject(new TypeError('network'));
    expect(await bad).toBeNull();
    expect(store.state?.step).toBe(2);
    expect(store.failed).toBe(false);
  });

  it('first failed read sets failed, with the sentence; a good read clears it', async () => {
    const bad = store.read();
    gets[0].reject(new ApiError(500, 'Boom.'));
    await bad;
    expect([store.failed, store.error]).toEqual([true, 'Boom.']);
    const ok = store.read();
    gets[1].resolve(state());
    await ok;
    expect([store.failed, store.error]).toEqual([false, null]);
  });

  it('401 goes to onAuth once', async () => {
    const a = store.read();
    const b = store.read();
    gets[0].reject(new ApiError(401, 'Not authenticated'));
    gets[1].reject(new ApiError(401, 'Not authenticated'));
    await Promise.all([a, b]);
    expect(onAuth).toHaveBeenCalledTimes(1);
    expect(onAuth).toHaveBeenCalledWith('signin');
  });

  it('a write queued while a read waits runs before that read', async () => {
    const a = deferred();
    const b = deferred();
    const one = store.write(() => a.promise);
    const read = store.read();
    const two = store.write(() => b.promise);
    a.resolve(state({ step: 2 }));
    await one;
    await settle();
    expect(gets).toHaveLength(0);   // the second write is still queued
    b.resolve(state({ step: 3 }));
    await two;
    await settle();
    expect(gets).toHaveLength(1);
    gets[0].resolve(state({ step: 4 }));
    expect((await read)?.step).toBe(4);
  });

  it('a 404 goes to onAuth once, as an expired link', async () => {
    const a = store.read();
    const b = store.read();
    gets[0].reject(new ApiError(404, 'Not Found'));
    gets[1].reject(new ApiError(404, 'Not Found'));
    await Promise.all([a, b]);
    expect(onAuth).toHaveBeenCalledTimes(1);
    expect(onAuth).toHaveBeenCalledWith('expired');
    expect(store.failed).toBe(false);
  });

  it('reading is true while a read runs, waiting on a write included, and false after a failure', async () => {
    expect(store.reading).toBe(false);
    const w = deferred();
    const written = store.write(() => w.promise);
    const read = store.read();
    expect(store.reading).toBe(true);
    w.resolve(state());
    await written;
    await settle();
    expect(store.reading).toBe(true);
    gets[0].reject(new ApiError(500, 'Boom.'));
    await read;
    expect(store.reading).toBe(false);
  });

  it('reading stays true while any of two reads runs', async () => {
    const a = store.read();
    const b = store.read();
    gets[0].resolve(state());
    await a;
    expect(store.reading).toBe(true);
    gets[1].resolve(state());
    await b;
    expect(store.reading).toBe(false);
  });

  it('keepAlive reads every 4 minutes while dirty', async () => {
    vi.useFakeTimers();
    let dirty = false;
    store.keepAlive(() => dirty);
    store.noteEdit();
    vi.advanceTimersByTime(240_000);
    expect(gets).toHaveLength(0);       // nothing typed: no read
    dirty = true;
    vi.advanceTimersByTime(239_999);
    expect(gets).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(gets).toHaveLength(1);
    gets[0].resolve(state());
    await settle();
    vi.advanceTimersByTime(240_000);
    expect(gets).toHaveLength(2);
  });

  it('keepAlive stops 2 hours after the last edit, and a new edit starts it again', async () => {
    vi.useFakeTimers();
    store.keepAlive(() => true);
    store.noteEdit();
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(240_000);
      gets[gets.length - 1]?.resolve(state());
      await settle();
    }
    // Reads at 4, 8, … 116 minutes; none at 120 or after.
    expect(gets).toHaveLength(29);
    store.noteEdit();
    vi.advanceTimersByTime(240_000);
    expect(gets).toHaveLength(30);
  });

  it("keepAlive's stop ends its own timer only, and the store keeps reading", async () => {
    vi.useFakeTimers();
    const stopOld = store.keepAlive(() => true);
    store.noteEdit();
    const stop = store.keepAlive(() => true);
    stopOld();                              // an older step's stop leaves the new timer
    vi.advanceTimersByTime(240_000);
    expect(gets).toHaveLength(1);
    gets[0].resolve(state());
    await settle();
    stop();
    vi.advanceTimersByTime(480_000);
    expect(gets).toHaveLength(1);
    const read = store.read();              // not disposed: reads still apply
    gets[1].resolve(state({ step: 2 }));
    expect((await read)?.step).toBe(2);
  });

  it('dispose stops the timer, and a late answer changes nothing', async () => {
    vi.useFakeTimers();
    store.keepAlive(() => true);
    store.noteEdit();
    const read = store.read();
    store.dispose();
    gets[0].resolve(state({ step: 3 }));
    await read;
    expect(store.state).toBeNull();
    vi.advanceTimersByTime(480_000);
    expect(gets).toHaveLength(1);
  });
});

describe('the four wizard writes (D13)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('post to their own URLs, the step in the body, without the sign-in redirect', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(state() as never);
    await setupGo('T', 3);
    await setupSkip('T', 2);
    await setupSaved('T', 4);
    await keepSignIn('T');
    expect(post.mock.calls).toEqual([
      ['/api/superuser/T/setup/go', { step: 3 }, { skipAuthRedirect: true }],
      ['/api/superuser/T/setup/skip', { step: 2 }, { skipAuthRedirect: true }],
      ['/api/superuser/T/setup/saved', { step: 4 }, { skipAuthRedirect: true }],
      ['/api/superuser/T/setup/keep-sign-in', undefined, { skipAuthRedirect: true }],
    ]);
  });
});

describe('entryMove and the mark (D1, D2)', () => {
  beforeEach(() => sessionStorage.clear());

  it("the panel's own address goes to Set up only while on and not marked", () => {
    expect(entryMove(undefined, state(), false)).toBe('to-setup');
    expect(entryMove(undefined, state(), true)).toBeNull();
    expect(entryMove(undefined, state({ wizard_on: false }), false)).toBeNull();
    expect(entryMove(undefined, state({ wizard_on: false }), true)).toBeNull();
  });

  it('another page never redirects', () => {
    for (const seg of ['users', 'courses', 'settings', 'branding']) {
      expect(entryMove(seg, state(), false)).toBeNull();
    }
  });

  it('Set up when over goes to the Dashboard, marked or not; when on it stays', () => {
    expect(entryMove('setup', state({ wizard_on: false }), false)).toBe('to-dashboard');
    expect(entryMove('setup', state({ wizard_on: false }), true)).toBe('to-dashboard');
    expect(entryMove('setup', state(), false)).toBeNull();
  });

  it('the mark holds the token; a mark for another token reads as none', () => {
    expect(markFor('T')).toBe(false);
    setMark('T');
    expect(sessionStorage.getItem(SETUP_MARK)).toBe('T');
    expect([markFor('T'), markFor('U')]).toEqual([true, false]);
    clearMark();
    expect(markFor('T')).toBe(false);
  });
});
