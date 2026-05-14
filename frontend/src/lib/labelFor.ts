// labelFor returns a non-empty display name for an entity (block / sequence /
// item) suitable for ARIA labels and visible-title rendering. Falls back
// through title → slug → caller-supplied positional fallback → "untitled".
// Whitespace-only inputs are treated as empty at every level (including the
// fallback), so multiple untitled rows still announce a distinguishable id
// when the caller passes a positional string like "block 3".

export function labelFor(
  title: string | null | undefined,
  slug: string | null | undefined,
  fallback?: string,
): string {
  return title?.trim() || slug?.trim() || fallback?.trim() || 'untitled';
}
