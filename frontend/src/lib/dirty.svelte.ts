// Tracker holds the form-shape: titles/slugs/markdown/URLs (string or null
// from the backend) and `max_quiz_attempts` (number). Pages that read from
// admin-tree fields like `video_url: string | null` and `content_md: string | null`
// pass them through unchanged — `null` is preserved end-to-end (the backend
// accepts `null` for "leave as-is" or as a real value depending on the schema).
type Allowed = string | number | null;

export function makeDirtyTracker<T extends Record<string, Allowed>>(initial: T) {
  let snapshot: T = { ...initial };
  const current = $state<T>({ ...initial });

  return {
    current,
    get isDirty(): boolean {
      for (const k of Object.keys(snapshot) as (keyof T)[]) {
        if (current[k] !== snapshot[k]) return true;
      }
      return false;
    },
    reset(next: T): void {
      snapshot = { ...next };
      for (const k of Object.keys(next) as (keyof T)[]) {
        current[k] = next[k];
      }
    },
  };
}
