import { api, ApiError } from './api';
import { session, clearSession } from '../stores/session.svelte';
import { clearCourse } from '../stores/currentCourse.svelte';
import { clearToasts } from '../stores/toasts.svelte';
import type { User } from './types';

export async function bootstrapSession(): Promise<void> {
  try {
    const u = await api.get<User>('/api/auth/me', { skipAuthRedirect: true });
    session.user = u;
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      session.user = null;
    } else {
      // Network error or 5xx — leave user=null, surface a toast for visibility.
      session.user = null;
      const msg = e instanceof ApiError ? e.displayMessage : 'Could not contact server.';
      const { pushToast } = await import('../stores/toasts.svelte');
      pushToast(msg, 'error');
    }
  } finally {
    session.loading = false;
  }
}

export async function requestPin(email: string): Promise<void> {
  await api.post('/api/auth/request-pin', { email });
}

export async function verifyPin(
  email: string,
  pin: string,
  duration_days: 1 | 7 | 30,
): Promise<User> {
  const { user } = await api.post<{ user: User }>(
    '/api/auth/verify-pin',
    { email, pin, duration_days },
    { skipAuthRedirect: true },
  );
  session.user = user;
  return user;
}

export async function getAuthConfig(): Promise<{ send_pin_enabled: boolean }> {
  // Public endpoint; never 401s, so no skipAuthRedirect needed.
  return api.get<{ send_pin_enabled: boolean }>('/api/auth/config');
}

export async function logout(): Promise<void> {
  try {
    await api.post('/api/auth/logout');
  } finally {
    clearSession();
    clearCourse();
    clearToasts();
  }
}
