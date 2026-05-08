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
  // Both snapshot and current are $state proxies. Snapshot reactivity is
  // critical for the post-save flow: reset() may be called with values that
  // already match what the user typed (server returned exactly what was sent).
  // In that case, current[k] = next[k] is a same-value write — Svelte 5 skips
  // the notification — so reactive consumers (Save button disabled state,
  // DirtyGuard) would remain stuck on the previous "dirty" reading. A reactive
  // snapshot fixes this: writes to snapshot[k] DO notify when the value
  // changes from old to new, forcing isDirty to re-evaluate.
  // Note: only keys present in the snapshot count toward isDirty. The flat
  // `Record<string, Allowed>` type allows extra runtime keys; consumers should
  // pass a strictly-typed object literal to avoid accidental untracked fields.
  const snapshot = $state<T>({ ...initial });
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
      for (const k of Object.keys(next) as (keyof T)[]) {
        snapshot[k] = next[k];
        current[k] = next[k];
      }
    },
  };
}
