import type { User } from '../lib/types';
import { rememberTeachingStatus } from '../lib/teachingFilter';

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
  // The next user starts from the default Teaching filter.
  rememberTeachingStatus('active');
}
