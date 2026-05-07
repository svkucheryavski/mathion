import { describe, it, expect, beforeEach, vi } from 'vitest';
import { matchRoute, safeNext } from '../lib/router.svelte';
import {
  navigate,
  registerNavigationGuard,
  currentRoute,
  __resetGuardsForTests,
} from '../lib/router.svelte';

describe('lib/router', () => {
  describe('matchRoute', () => {
    const routes = [
      { path: '/login', component: 'Login', auth: false },
      { path: '/courses', component: 'CourseList', auth: true },
      { path: '/courses/:courseSlug', component: 'CourseView', auth: true },
      { path: '/courses/:courseSlug/seq/:sequenceId', component: 'SequencePlayer', auth: true },
    ];

    it('matches a static path', () => {
      const m = matchRoute(routes, '/login');
      expect(m?.route.component).toBe('Login');
      expect(m?.params).toEqual({});
    });

    it('matches a single-param path', () => {
      const m = matchRoute(routes, '/courses/algebra-1');
      expect(m?.route.component).toBe('CourseView');
      expect(m?.params).toEqual({ courseSlug: 'algebra-1' });
    });

    it('matches a multi-param path', () => {
      const m = matchRoute(routes, '/courses/algebra-1/seq/42');
      expect(m?.route.component).toBe('SequencePlayer');
      expect(m?.params).toEqual({ courseSlug: 'algebra-1', sequenceId: '42' });
    });

    it('returns null for no match', () => {
      expect(matchRoute(routes, '/nope/here')).toBeNull();
    });

    it('does not partial-match', () => {
      expect(matchRoute(routes, '/courses/algebra-1/extra/bits')).toBeNull();
    });
  });

  describe('safeNext', () => {
    it('passes through same-origin path', () => {
      expect(safeNext('/courses/foo', 'http://localhost')).toBe('/courses/foo');
    });

    it('preserves search and hash', () => {
      expect(safeNext('/courses/foo?x=1#item=2', 'http://localhost')).toBe('/courses/foo?x=1#item=2');
    });

    it('falls back on cross-origin URL', () => {
      expect(safeNext('https://attacker.com/foo', 'http://localhost')).toBe('/courses');
    });

    it('falls back on protocol-only', () => {
      expect(safeNext('javascript:alert(1)', 'http://localhost')).toBe('/courses');
    });

    it('falls back on backslash-prefixed', () => {
      expect(safeNext('\\\\evil.com', 'http://localhost')).toBe('/courses');
    });

    it('falls back on empty / invalid', () => {
      expect(safeNext('', 'http://localhost')).toBe('/courses');
    });

    it('falls back when target is /login (prevents loop trap)', () => {
      expect(safeNext('/login', 'http://localhost')).toBe('/courses');
      expect(safeNext('/login?next=/login', 'http://localhost')).toBe('/courses');
    });
  });
});

describe('navigation guards', () => {
  // F5 (test isolation): reset guard registry + URL state before every test.
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardsForTests();
    history.replaceState(null, '', '/');
    currentRoute.path = '/';
    currentRoute.search = '';
    currentRoute.hash = '';
  });

  it('cancels navigate when a guard returns false', async () => {
    const dispose = registerNavigationGuard(() => false);
    await navigate('/courses');
    expect(currentRoute.path).toBe('/');
    dispose();
  });

  it('proceeds when guards return true', async () => {
    const dispose = registerNavigationGuard(() => true);
    await navigate('/courses');
    expect(currentRoute.path).toBe('/courses');
    dispose();
  });

  it('disposer removes the guard', async () => {
    const dispose = registerNavigationGuard(() => false);
    dispose();
    await navigate('/courses');
    expect(currentRoute.path).toBe('/courses');
  });

  it('async guards are awaited', async () => {
    const dispose = registerNavigationGuard(async () => false);
    await navigate('/courses');
    expect(currentRoute.path).toBe('/');
    dispose();
  });

  it('popstate cancellation restores URL via pushState (no Back/Forward direction guess)', async () => {
    // Seed two history entries beyond '/'.
    await navigate('/courses');
    await navigate('/courses/foo');
    expect(currentRoute.path).toBe('/courses/foo');

    const dispose = registerNavigationGuard(() => false);

    const popped = new Promise<void>((res) => {
      const handler = () => { window.removeEventListener('popstate', handler); res(); };
      window.addEventListener('popstate', handler);
    });
    history.back();
    await popped;
    // Allow the router's async popstate handler to run its guard chain + pushState restore.
    await new Promise((r) => setTimeout(r, 0));

    expect(location.pathname).toBe('/courses/foo');
    expect(currentRoute.path).toBe('/courses/foo');
    dispose();
  });

  // -------------------------------------------------------------------
  // New tests for post-task-10 polish findings
  // -------------------------------------------------------------------

  // F3: Concurrent navigate — the older (slower) guard chain must not win.
  it('concurrent navigate: later navigate wins, earlier stale commit is dropped', async () => {
    let resolveSlowGuard!: (v: boolean) => void;
    const slowGuardPromise = new Promise<boolean>((res) => { resolveSlowGuard = res; });

    // First guard is slow (will only resolve after we kick off the second navigate).
    const disposeA = registerNavigationGuard(() => slowGuardPromise);

    // Start navigate('/a') but don't await — its guard is blocking.
    const navAPromise = navigate('/a');

    // Immediately remove the slow guard and navigate to '/b' so it completes first.
    disposeA();
    await navigate('/b');

    // Now unblock and await the first navigate — it should detect it lost the race.
    resolveSlowGuard(true);
    await navAPromise;

    expect(currentRoute.path).toBe('/b');
  });

  // F7: Self-disposing guard must not skip later guards in the same run.
  it('self-disposing guard does not skip subsequent guards in the snapshot', async () => {
    const callLog: string[] = [];
    let disposeA!: () => void;

    disposeA = registerNavigationGuard(() => {
      callLog.push('A');
      disposeA(); // A disposes itself mid-iteration
      return true;
    });

    registerNavigationGuard(() => {
      callLog.push('B');
      return true;
    });

    await navigate('/courses');

    // Both guards must have been called despite A self-disposing.
    expect(callLog).toEqual(['A', 'B']);
    expect(currentRoute.path).toBe('/courses');
    // B is still registered; clean up.
    __resetGuardsForTests();
  });

  // F5: Hash-only navigate bypasses guards (guard never invoked) and commits the new hash.
  it('hash-only navigate bypasses guards and commits new hash', async () => {
    // Start at /courses (no hash).
    await navigate('/courses');
    expect(currentRoute.path).toBe('/courses');

    // Spy on the guard so we can assert it was NOT called for hash-only changes.
    const guardSpy = vi.fn(() => false);
    const dispose = registerNavigationGuard(guardSpy);

    // Navigate to the same path with a hash — guards must be skipped entirely.
    await navigate('/courses#section-2');

    expect(guardSpy).not.toHaveBeenCalled();
    expect(currentRoute.hash).toBe('#section-2');
    expect(currentRoute.path).toBe('/courses');
    dispose();
  });

  // F6: force:true bypasses guards.
  it('force:true navigate bypasses guards and commits the path', async () => {
    const dispose = registerNavigationGuard(() => false);
    await navigate('/x', { force: true });
    expect(currentRoute.path).toBe('/x');
    dispose();
  });

  // F1: a throwing pushState during popstate restore must not leave guards
  // permanently bypassed. The try/finally in the popstate handler is what
  // guarantees this; without it, suppressGuards would stay true forever.
  it('throwing pushState during popstate restore does not leave guards bypassed', async () => {
    // Seed two history entries beyond '/'.
    await navigate('/a');
    await navigate('/b');

    // Block any pop-style navigation.
    const dispose = registerNavigationGuard(() => false);

    // Make pushState throw exactly once (the next call), then restore.
    const realPush = history.pushState;
    let throwOnce = true;
    history.pushState = function (...args: Parameters<typeof realPush>) {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('simulated pushState failure');
      }
      return realPush.apply(this, args);
    };

    // Trigger Back; the popstate handler will run guards, then attempt the
    // restore pushState (which will throw).
    const popped = new Promise<void>((res) => {
      const handler = () => { window.removeEventListener('popstate', handler); res(); };
      window.addEventListener('popstate', handler);
    });
    history.back();
    try { await popped; } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 0));

    history.pushState = realPush;
    dispose();

    // After the throw, guards must still gate navigation. Register a blocking
    // guard and try to navigate — if suppressGuards leaked true, this would
    // commit; with the try/finally fix, it should be cancelled.
    const blockerSpy = vi.fn(() => false);
    const blockerDispose = registerNavigationGuard(blockerSpy);
    const beforePath = currentRoute.path;
    await navigate('/should-not-commit');
    expect(blockerSpy).toHaveBeenCalled();
    expect(currentRoute.path).toBe(beforePath);
    blockerDispose();
  });
});
