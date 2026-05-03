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
    if (!(e instanceof ApiError && e.status === 401)) throw e;
    session.user = null;
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
  const { user } = await api.post<{ user: User }>('/api/auth/verify-pin', {
    email,
    pin,
    duration_days,
  });
  session.user = user;
  return user;
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
