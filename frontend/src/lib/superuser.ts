import { api } from './api';

export type SuperuserStats = {
  total_users: number;
  total_courses: number;
  storage_bytes: number;
  active_users_24h: number;
  active_users_7d: number;
};

export function getSuperuserStats(token: string): Promise<SuperuserStats> {
  // skipAuthRedirect: the dashboard handles 401/404 itself (does not hand the
  // 401 to the app-wide onUnauthorized redirect).
  return api.get<SuperuserStats>(`/api/superuser/${token}/stats`, { skipAuthRedirect: true });
}
