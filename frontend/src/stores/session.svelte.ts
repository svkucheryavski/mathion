import type { User } from '../lib/types';

export const session = $state<{
  user: User | null;
  loading: boolean;
}>({
  user: null,
  loading: true,
});

export function clearSession(): void {
  session.user = null;
  session.loading = false;
}
