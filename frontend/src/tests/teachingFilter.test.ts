import { describe, it, expect, vi } from 'vitest';
import { rememberTeachingStatus, teachingHref } from '../lib/teachingFilter';
import { logout } from '../lib/auth.svelte';
import { clearSession } from '../stores/session.svelte';

describe('teachingFilter', () => {
  it('a logout forgets the last status filter', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    rememberTeachingStatus('upcoming');
    expect(teachingHref()).toBe('/teaching?status=upcoming');
    await logout();
    expect(teachingHref()).toBe('/teaching');
    vi.unstubAllGlobals();
  });

  it('a session cleared by a 401 forgets it too', () => {
    rememberTeachingStatus('ended');
    clearSession();
    expect(teachingHref()).toBe('/teaching');
  });
});
