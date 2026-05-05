import { describe, it, expect } from 'vitest';
import { matchRoute, safeNext } from '../lib/router.svelte';

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
