import { describe, it, expect } from 'vitest';
import { session, clearSession } from '../stores/session.svelte';

describe('stores/session', () => {
  it('starts with user=null and loading=true', () => {
    expect(session.user).toBeNull();
    expect(session.loading).toBe(true);
  });

  it('clearSession sets user=null and loading=false', () => {
    session.user = { id: 1, email: 'a@b', full_name: null, is_superuser: false, is_disabled: false, photo_url: null, has_course_admin: false, has_run_teacher: false };
    session.loading = true;
    clearSession();
    expect(session.user).toBeNull();
    expect(session.loading).toBe(false);
  });
});
