// Per-item coverage tracker factory.
// - Accrues active time from performance.now() deltas while document is visible
// - Posts incremental time_spent every 15s (clamped to 60s per post)
// - markCovered() sends is_covered=true with the current accumulated delta
// - 403 from /track => silently stop (admin disabled the version)
// - start() is idempotent; stop() removes listeners + cancels interval + flushes

const POST_INTERVAL_MS = 15_000;
const MAX_POST_SECONDS = 60;

export type TrackPayload = { time_spent: number; is_covered?: boolean };
export type PostTrack = (itemId: number, payload: TrackPayload) => Promise<void>;

export type CoverageOpts = {
  /** Test seam — defaults to performance.now. */
  now?: () => number;
  /** Test seam — defaults to a real fetch via /api/items/:id/track. */
  postTrack?: PostTrack;
};

export type CoverageTracker = {
  start: () => void;
  stop: () => Promise<void>;
  markCovered: () => Promise<void>;
};

export function createCoverageTracker(
  itemId: number,
  opts: CoverageOpts = {},
): CoverageTracker {
  const now = opts.now ?? (() => performance.now());
  const postTrack = opts.postTrack ?? defaultPostTrack;

  let started = false;
  let stopped = false;
  let killed = false; // 403 latch: stop accruing + posting forever
  let lastSampleMs: number | null = null;
  let pendingMs = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function visibilityHandler(): void {
    if (killed) return;
    if (document.visibilityState === 'visible') {
      lastSampleMs = now();
    } else {
      sample();
      lastSampleMs = null;
    }
  }

  function sample(): void {
    if (killed) return;
    if (lastSampleMs === null) return;
    if (document.visibilityState !== 'visible') return;
    const t = now();
    pendingMs += t - lastSampleMs;
    lastSampleMs = t;
  }

  async function flush(extra: { is_covered?: boolean } = {}): Promise<void> {
    if (killed) return;
    sample();
    const seconds = Math.min(MAX_POST_SECONDS, Math.floor(pendingMs / 1000));
    if (seconds <= 0 && !extra.is_covered) return;
    pendingMs = Math.max(0, pendingMs - seconds * 1000);
    try {
      await postTrack(itemId, { time_spent: seconds, ...extra });
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 403) {
        killed = true;
        return;
      }
      // Swallow other errors — coverage tracking is best-effort.
    }
  }

  return {
    start(): void {
      if (started) return; // idempotent
      started = true;
      stopped = false;
      lastSampleMs = document.visibilityState === 'visible' ? now() : null;
      document.addEventListener('visibilitychange', visibilityHandler);
      intervalId = setInterval(() => {
        void flush();
      }, POST_INTERVAL_MS);
    },

    async stop(): Promise<void> {
      if (!started || stopped) return;
      stopped = true;
      document.removeEventListener('visibilitychange', visibilityHandler);
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      await flush();
    },

    async markCovered(): Promise<void> {
      if (killed) return;
      await flush({ is_covered: true });
    },
  };
}

const defaultPostTrack: PostTrack = async (itemId, payload) => {
  const { api } = await import('./api');
  await api.post(`/api/items/${itemId}/track`, payload);
};
