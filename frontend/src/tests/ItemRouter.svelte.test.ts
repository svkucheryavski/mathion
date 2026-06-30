import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemRouter from '../components/items/ItemRouter.svelte';
import type { InteractiveAppItem, VersionState } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

it('dispatches an interactive_app item to InteractiveAppItem, not UnsupportedItem', () => {
  const item: InteractiveAppItem = {
    id: 5, sequence_id: 1, title: 'App', slug: 'app', order: 1,
    type: 'interactive_app', script_url: 'https://example.com/app',
  };
  // Mark item 5 already-covered so InteractiveAppItem's auto-cover effect skips
  // markCovered() — this keeps the routing test synchronous (no dynamic
  // import('./api') + fetch left pending past afterEach's fetch-restore).
  const state: VersionState = {
    version_id: 1,
    items: {
      '5': {
        is_covered: true, time_spent_seconds: 0, last_visited_at: null,
        last_answers: null, attempt_count: 0, score_correct: null, score_total: null,
      },
    },
  };
  // Pin performance.now to a constant so the coverage tracker accrues exactly 0ms.
  // is_covered:true already skips markCovered(), but the tracker is still started,
  // and its cleanup stop()->flush() would — with the real, process-relative clock —
  // post time_spent=floor(elapsed/1000) if >=1s elapsed between mount and the
  // afterEach unmount. A constant clock makes that flush deterministically 0s (no POST).
  const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const props = $state({ item, state });   // $state() must initialize a variable (runes rule)
    const cmp = mount(ItemRouter, { target, props });
    cleanup = () => unmount(cmp);
    flushSync();
    expect(target.querySelector('iframe')).not.toBeNull();
    expect(target.textContent).not.toContain("isn't available");
    expect(fetchSpy).not.toHaveBeenCalled();   // pure routing — no coverage POST
    // Unmount under the pinned clock so the tracker's cleanup stop()->flush()
    // accrues 0s and issues no /track POST after fetch is restored.
    cleanup?.(); cleanup = null;
  } finally {
    nowSpy.mockRestore();
  }
});
