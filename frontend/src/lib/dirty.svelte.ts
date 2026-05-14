// Tracker holds the form-shape: titles/slugs/markdown/URLs (string or null
// from the backend) and `max_quiz_attempts` (number). Pages that read from
// admin-tree fields like `video_url: string | null` and `content_md: string | null`
// pass them through unchanged — `null` is preserved end-to-end (the backend
// accepts `null` for "leave as-is" or as a real value depending on the schema).
type Allowed = string | number | null;

export type DirtyTracker<T extends Record<string, Allowed>> = {
  current: T;
  readonly isDirty: boolean;
  reset(next: T): void;
};

export function makeDirtyTracker<T extends Record<string, Allowed>>(initial: T): DirtyTracker<T> {
  // Contract: both `snapshot` and `current` are $state proxies — the isDirty
  // getter reads both on every evaluation, so both must notify reactive
  // consumers (Save button disabled state, DirtyGuard) when they change.
  // The non-obvious case is reset() after a post-save refetch where the
  // server returned exactly what the user typed: `current[k] = next[k]` is
  // a same-value write Svelte 5 skips, so without a reactive snapshot the
  // consumer would stay stuck on the old "dirty" reading. Because snapshot
  // is $state, `snapshot[k] = next[k]` (going 'a' → 'b' for example) DOES
  // notify, forcing isDirty to re-evaluate. See test
  // 'reactive consumer reruns when reset() makes current a same-value write'
  // at dirty.test.ts:79 for the discriminating regression repro.
  const snapshot = $state<T>({ ...initial });
  const current = $state<T>({ ...initial });

  return {
    current,
    get isDirty(): boolean {
      // Iterate over the UNION of keys: a caller that adds a key to current
      // not present in initial must still see isDirty flip true. The TS
      // literal-type discipline guards most call sites at compile-time, but
      // the runtime contract should match the type contract.
      const keys = new Set<string>([...Object.keys(snapshot), ...Object.keys(current)]);
      for (const k of keys) {
        if (current[k as keyof T] !== snapshot[k as keyof T]) return true;
      }
      return false;
    },
    reset(next: T): void {
      for (const k of Object.keys(next) as (keyof T)[]) {
        snapshot[k] = next[k];
        current[k] = next[k];
      }
    },
  };
}
