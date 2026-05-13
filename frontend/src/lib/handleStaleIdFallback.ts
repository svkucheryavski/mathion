// handleStaleIdFallback resolves a stale-id condition discovered by the
// validation $effect: toasts a user-facing 'info' message (this is a
// benign redirection, not an error) and navigates (replace + force) to
// the nearest valid parent URL. staleBid wins over staleSid because a
// missing block makes any nested sequence URL moot (cascade-deleted or
// unreachable). `force: true` bypasses DirtyGuard — prompting "save your
// changes?" on a deleted entity is pointless; Cancel would re-trigger
// the stale-id loop.
//
// Dependencies (pushToast, navigate) are injected so the helper stays
// pure-ish and vitest-testable without DOM.

export type StaleFlags = {
  staleBid: boolean;
  staleSid: boolean;
};

export type StaleContext = {
  courseSlug: string;
  vid: string;
  bid: string | null;
};

export type StaleDeps = {
  pushToast: (msg: string, kind: 'info' | 'success' | 'error') => void;
  navigate: (path: string, opts: { replace: boolean; force: boolean }) => void;
};

export function handleStaleIdFallback(
  flags: StaleFlags,
  ctx: StaleContext,
  deps: StaleDeps,
): void {
  if (flags.staleBid) {
    deps.pushToast('Block not found.', 'info');
    deps.navigate(`/courses/${ctx.courseSlug}/edit/v/${ctx.vid}`, { replace: true, force: true });
    return;
  }
  if (flags.staleSid && ctx.bid !== null) {
    deps.pushToast('Sequence not found.', 'info');
    deps.navigate(`/courses/${ctx.courseSlug}/edit/v/${ctx.vid}/blocks/${ctx.bid}`, { replace: true, force: true });
    return;
  }
}
