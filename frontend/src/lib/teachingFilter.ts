// The Teaching page's last status filter, so a run page's crumb goes back to it (C18).
// Plain, not $state: the crumb reads it once, when it mounts.
let last: string | null = null;

/** The Teaching page records its pill; the default (active) keeps a bare address. */
export function rememberTeachingStatus(status: string): void {
  last = status === 'active' ? null : status;
}

/** Where "Teaching" links lead: the filtered list the teacher came from. */
export function teachingHref(): string {
  return last ? `/teaching?status=${encodeURIComponent(last)}` : '/teaching';
}
