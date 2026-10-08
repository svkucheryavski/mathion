import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemRouter from '../components/items/ItemRouter.svelte';
import type { InteractiveAppItem, Item, MiniProjectItem, VersionState } from '../lib/types';

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
    type: 'interactive_app', script_url: 'app.js',
  };
  const state: VersionState = {
    version_id: 1,
    items: {
      '5': {
        is_covered: true, time_spent: 0, last_visited_at: null,
        last_answers: null, attempt_count: 0, max_attempts: 3, last_score: null,
      },
    },
  };
  // Pure routing assertion: InteractiveAppItem renders <article class="interactive-app">
  // + <h2> synchronously (outside the async source-load conditionals). currentCourse is
  // left unseeded, so the player's effect early-returns (versionId undefined) — no
  // tracker, no source fetch, no coverage POST — keeping this a synchronous unit test of
  // ItemRouter's dispatch. The player's async render/coverage is covered by
  // InteractiveAppItem.svelte.test.ts.
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ item, state });   // $state() must initialize a variable (runes rule)
  const cmp = mount(ItemRouter, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  expect(target.querySelector('.interactive-app')).not.toBeNull();
  expect(target.querySelector('.interactive-app h2')?.textContent).toBe('App');
  expect(target.textContent).not.toContain("isn't available");
  expect(fetchSpy).not.toHaveBeenCalled();   // unseeded versionId → no source fetch
});

// --- T5: mini_project dispatch (codex-r19-I5) -------------------------------
// T5 edits BOTH UnsupportedItem call sites (:21 and :27) to drop the `type=`
// pass. The interactive_app case above never mounts UnsupportedItem, so without
// this nothing proves a mini_project item still routes there after the edit.
it('dispatches a mini_project item to UnsupportedItem with type-neutral copy', () => {
  // Typed as MiniProjectItem, not cast. `as unknown as InteractiveAppItem`
  // would declare a mini_project item to be an interactive_app one and swallow
  // any future field added to MiniProjectItem — while MiniProjectItem is a
  // real member of the Item union (types.ts:62), so no cast is needed at all.
  const item: MiniProjectItem = {
    id: 11, sequence_id: 1, title: 'Group build', slug: 'group-build', order: 2,
    type: 'mini_project',
  };
  const state: VersionState = {
    version_id: 1,
    items: {
      '11': {
        is_covered: false, time_spent: 0, last_visited_at: null,
        last_answers: null, attempt_count: 0, max_attempts: 3, last_score: null,
      },
    },
  };
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state<{ item: Item; state: VersionState }>({ item, state });
  const cmp = mount(ItemRouter, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();

  expect(target.querySelector('.unsupported')).not.toBeNull();
  const text = target.textContent ?? '';
  expect(text).toContain("isn't available");
  expect(text).not.toContain('mini_project');
  expect(text).not.toContain('(');
});
