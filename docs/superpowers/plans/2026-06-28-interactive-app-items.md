# Interactive-App Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `interactive_app` item type to the Mathion frontend — admins author an external app URL, students view it in a sandboxed iframe that auto-marks coverage on view — completing the last unimplemented content type.

**Architecture:** Frontend-only (backend already models `script_url`). New `safeAppUrl` sanitizer (wraps `safeIframeUrl` + mixed-content guard), new `InteractiveFrame` (sandboxed iframe wrapper) and `InteractiveAppItem` (student player with auto-coverage `$effect`), plus wiring into `ItemRouter`, `ItemTypePicker`, `SequenceAccordion` (create), and `ItemEditPage` (edit + read-only preview). Mirrors the existing `video` item type, with deliberate differences (sandbox, no URL normalization, auto-coverage + time tracking, fixed sizing, client-side sanitization).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest (`mount`/`unmount`/`flushSync`/`tick` from `svelte`), FastAPI backend (unchanged).

**Spec:** `docs/superpowers/specs/2026-06-28-interactive-app-items-design.md` (converged: 5-reviewer panel + 3 codex rounds, codex APPROVE).

## Global Constraints

- **Svelte 5 only, no JS/CSS dependencies.** Runes (`$state`/`$derived`/`$effect`/`$props`/`untrack`).
- **Component tests use `mount`/`unmount`/`flushSync`/`tick` from `svelte`, NOT `@testing-library`.**
- **No backend changes → no new pytest.** All work is under `frontend/src/`.
- **`safeAppUrl` is the interactive_app sanitizer** at every render/preview/save/create surface; **`video` keeps using `safeIframeUrl` directly** — do not reroute video.
- **Sandbox attribute is exactly `sandbox="allow-scripts"`** plus `referrerpolicy="no-referrer"`, **no `allowfullscreen`**. Never add: `allow-same-origin`, `allow-top-navigation`/`-by-user-activation`/`-to-custom-protocols`, `allow-popups-to-escape-sandbox`, `allow-downloads`, `allow-modals`, `allow-storage-access-by-user-activation`.
- **No URL normalization** for interactive_app (that is video-only); PATCH/POST `script_url` verbatim.
- **Auto-coverage fires once per item view**, guarded by `isCovered` read via `untrack` — no separate latch.
- **Git:** stage explicit file paths only (never `git add -A`/`git add .`). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Already on branch `feat/interactive-app-items`.
- **Run tests** from `frontend/`: single file `npx vitest run src/tests/<file>`; type-check `npx svelte-check --tsconfig ./tsconfig.json` (expect 0 errors).

---

### Task 1: `safeAppUrl` sanitizer

**Files:**
- Create: `frontend/src/lib/safeAppUrl.ts`
- Modify: `frontend/src/lib/safeIframeUrl.ts:1-7` (doc comment only)
- Test: `frontend/src/tests/safeAppUrl.test.ts`

**Interfaces:**
- Consumes: `safeIframeUrl(value: string | null | undefined): string | null` from `./safeIframeUrl` (existing — accepts http/https, rejects empty/no-host/non-http(s)/malformed, returns canonicalized URL string).
- Produces: `safeAppUrl(value: string | null | undefined, pageProtocol?: string): string | null` — returns `safeIframeUrl(value)`, but `null` when the accepted URL's protocol is `http:` and `pageProtocol === 'https:'`. `pageProtocol` defaults to `window.location.protocol` (a test seam). Consumed by Tasks 3, 6, 7.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/safeAppUrl.test.ts`:

```ts
import { it, expect } from 'vitest';
import { safeAppUrl } from '../lib/safeAppUrl';

it('accepts https on an https page', () => {
  expect(safeAppUrl('https://example.com/app', 'https:')).toBe('https://example.com/app');
});

it('accepts http on an http (dev) page', () => {
  expect(safeAppUrl('http://localhost:8000/app', 'http:')).toBe('http://localhost:8000/app');
});

it('rejects http on an https page (mixed content)', () => {
  expect(safeAppUrl('http://example.com/app', 'https:')).toBeNull();
});

it('accepts https on an http page', () => {
  expect(safeAppUrl('https://example.com/app', 'http:')).toBe('https://example.com/app');
});

it('rejects everything safeIframeUrl rejects, regardless of page protocol', () => {
  expect(safeAppUrl('', 'https:')).toBeNull();
  expect(safeAppUrl('https://', 'https:')).toBeNull();        // no host
  expect(safeAppUrl('javascript:alert(1)', 'http:')).toBeNull();
  expect(safeAppUrl('not a url', 'https:')).toBeNull();
  expect(safeAppUrl(null, 'https:')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/safeAppUrl.test.ts`
Expected: FAIL — `Failed to resolve import '../lib/safeAppUrl'`.

- [ ] **Step 3: Create the implementation**

Create `frontend/src/lib/safeAppUrl.ts`:

```ts
// Sanitizer for interactive_app `script_url` before iframing. Wraps
// safeIframeUrl (which gates scheme / host / malformed input) and ADDS a
// mixed-content guard: an http:// app embedded on an https:// page is blocked
// by the browser as mixed content and silently fails to render. Because the
// student player auto-marks coverage on view and a cross-origin iframe load
// failure is NOT detectable from JS, an unrenderable http:// app would
// otherwise be credited as covered (phantom coverage). So we reject http://
// when the page itself is https://, while still allowing http on http dev.
//
// `pageProtocol` defaults to window.location.protocol; it is a parameter so
// unit tests can drive both deployment modes without stubbing window.
import { safeIframeUrl } from './safeIframeUrl';

export function safeAppUrl(
  value: string | null | undefined,
  pageProtocol: string = window.location.protocol,
): string | null {
  const safe = safeIframeUrl(value);
  if (safe === null) return null;
  // safeIframeUrl canonicalizes via `new URL(...).toString()`, so the protocol
  // here is reliably lowercase 'http:' or 'https:'.
  if (new URL(safe).protocol === 'http:' && pageProtocol === 'https:') return null;
  return safe;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/safeAppUrl.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update the stale `safeIframeUrl` doc comment**

In `frontend/src/lib/safeIframeUrl.ts`, replace the comment line (currently `// preview and the disabled-version readonly preview.`) so the helper's documented consumers include the interactive-app surfaces. Change lines 3-4 from:

```ts
// malformed URLs the URL constructor refuses. Used by the video-item editor
// preview and the disabled-version readonly preview.
```

to:

```ts
// malformed URLs the URL constructor refuses. Used directly by the video-item
// editor preview / readonly preview, and (via lib/safeAppUrl) by the
// interactive-app player, editor preview, and readonly preview.
```

- [ ] **Step 6: Type-check and commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

```bash
git add frontend/src/lib/safeAppUrl.ts frontend/src/lib/safeIframeUrl.ts frontend/src/tests/safeAppUrl.test.ts
git commit -m "feat(frontend): add safeAppUrl sanitizer with mixed-content guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `InteractiveFrame` sandboxed iframe wrapper

**Files:**
- Create: `frontend/src/components/items/InteractiveFrame.svelte`
- Test: `frontend/src/tests/InteractiveFrame.svelte.test.ts`

**Interfaces:**
- Produces: `<InteractiveFrame src={string} title={string} />` — a fixed-height (600px), full-width `<iframe>` with `sandbox="allow-scripts"`, `referrerpolicy="no-referrer"`, no `allowfullscreen`. Caller passes an already-sanitized `src`. Consumed by Tasks 3, 7.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/InteractiveFrame.svelte.test.ts`:

```ts
import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveFrame from '../components/items/InteractiveFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { src: string; title: string }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(InteractiveFrame, { target, props: $state(props) });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector('iframe') as HTMLIFrameElement;
}

it('renders the sanitized src and title', () => {
  const f = mountFrame({ src: 'https://example.com/app', title: 'My app' });
  expect(f.getAttribute('src')).toBe('https://example.com/app');
  expect(f.getAttribute('title')).toBe('My app');
});

it('sandbox is exactly allow-scripts (no allow-same-origin)', () => {
  const f = mountFrame({ src: 'https://example.com/app', title: 'My app' });
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
});

it('sets referrerpolicy=no-referrer and omits allowfullscreen', () => {
  const f = mountFrame({ src: 'https://example.com/app', title: 'My app' });
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(f.hasAttribute('allowfullscreen')).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/InteractiveFrame.svelte.test.ts`
Expected: FAIL — `Failed to resolve import '../components/items/InteractiveFrame.svelte'`.

- [ ] **Step 3: Create the implementation**

Create `frontend/src/components/items/InteractiveFrame.svelte`:

```svelte
<script lang="ts">
  // Shared fixed-height (600px) sandboxed iframe wrapper for interactive apps.
  // Used by the student-side InteractiveAppItem and the editor's live/readonly
  // preview. Callers pass an already-sanitized `src` (see lib/safeAppUrl).
  //
  // sandbox="allow-scripts" WITHOUT allow-same-origin keeps the app in an
  // opaque origin (no parent DOM/cookie/storage access). NEVER add
  // allow-same-origin (de-isolation), allow-top-navigation* (tab-hijack),
  // allow-popups-to-escape-sandbox, allow-downloads, allow-modals, or
  // allow-storage-access-by-user-activation. No allowfullscreen (out of scope).
  let { src, title }: { src: string; title: string } = $props();
</script>

<div class="frame">
  <iframe {src} {title} sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
</div>

<style>
  .frame { width: 100%; height: 600px; margin-bottom: var(--space-3); }
  .frame iframe { width: 100%; height: 100%; border: 0; }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/InteractiveFrame.svelte.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check and commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

```bash
git add frontend/src/components/items/InteractiveFrame.svelte frontend/src/tests/InteractiveFrame.svelte.test.ts
git commit -m "feat(frontend): add InteractiveFrame sandboxed iframe wrapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `InteractiveAppItem` student player (auto-coverage)

**Files:**
- Create: `frontend/src/components/items/InteractiveAppItem.svelte`
- Test: `frontend/src/tests/InteractiveAppItem.svelte.test.ts`

**Interfaces:**
- Consumes: `safeAppUrl` (Task 1); `<InteractiveFrame src title />` (Task 2); `createCoverageTracker(itemId: number)` from `../../lib/coverage.svelte` (existing — `.start()`, `.stop()`, `.markCovered(): Promise<void>`); `markItemCovered(itemId: number): void` from `../../stores/currentCourse.svelte` (existing); `InteractiveAppItem` type from `../../lib/types` (existing: `{ id, sequence_id, title, slug, order, type: 'interactive_app', script_url: string }`).
- Produces: `<InteractiveAppItem item={InteractiveAppItem} isCovered={boolean} />`. Consumed by Task 4.

**Coverage contract (verified against `coverage.svelte.ts`):** `start()` then `markCovered()` posts `{ time_spent: 0, is_covered: true }` once (flush proceeds at 0 seconds because `is_covered` is truthy) via `api.post('/api/items/:id/track', …)` → global `fetch`; the interval keeps accruing active time; cleanup `stop()` flushes the remainder. Reading `isCovered` via `untrack` stops the `markItemCovered` store write from re-invalidating the effect, so it fires at most once per item view (re-firing only on a genuine `item.id`/URL change). No latch needed.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/InteractiveAppItem.svelte.test.ts`:

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveAppItem from '../components/items/InteractiveAppItem.svelte';
import { __test__setSlots } from '../stores/currentCourse.svelte';
import type { InteractiveAppItem as IAItem } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const appItem = (over: Partial<IAItem> = {}): IAItem => ({
  id: 7, sequence_id: 3, title: 'Sandbox', slug: 'sandbox', order: 1,
  type: 'interactive_app', script_url: 'https://example.com/app', ...over,
});

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  __test__setSlots(null);
});

function mountItem(props: { item: IAItem; isCovered: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(InteractiveAppItem, { target, props: $state(props) });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
const trackCalls = () =>
  fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/items/7/track'));

it('renders the iframe and auto-marks coverage once when not covered', async () => {
  const target = mountItem({ item: appItem(), isCovered: false });
  expect(target.querySelector('iframe')).not.toBeNull();
  await settle();
  expect(trackCalls().length).toBe(1);
  const body = JSON.parse((trackCalls()[0][1] as RequestInit).body as string);
  expect(body.is_covered).toBe(true);
});

it('does NOT mark coverage when already covered', async () => {
  mountItem({ item: appItem(), isCovered: true });
  await settle();
  expect(trackCalls().length).toBe(0);
});

it('shows a notice and skips iframe + coverage on an unsafe URL', async () => {
  const target = mountItem({ item: appItem({ script_url: 'javascript:alert(1)' }), isCovered: false });
  expect(target.querySelector('iframe')).toBeNull();
  expect(target.textContent).toContain("can't be displayed");
  await settle();
  expect(trackCalls().length).toBe(0);
});

it('falls back to a generic iframe title when item.title is empty', () => {
  const target = mountItem({ item: appItem({ title: '' }), isCovered: true });
  expect(target.querySelector('iframe')?.getAttribute('title')).toBe('Interactive app');
});
```

> Note: `safeAppUrl` defaults `pageProtocol` to `window.location.protocol`, which is `http:` under jsdom — so an `https://` fixture URL is accepted (no mixed-content rejection). The http-on-https rejection itself is covered by `safeAppUrl.test.ts` (Task 1), avoiding a `window.location` stub here.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/InteractiveAppItem.svelte.test.ts`
Expected: FAIL — `Failed to resolve import '../components/items/InteractiveAppItem.svelte'`.

- [ ] **Step 3: Create the implementation**

Create `frontend/src/components/items/InteractiveAppItem.svelte`:

```svelte
<script lang="ts">
  import { untrack } from 'svelte';
  import type { InteractiveAppItem } from '../../lib/types';
  import { safeAppUrl } from '../../lib/safeAppUrl';
  import { createCoverageTracker } from '../../lib/coverage.svelte';
  import { markItemCovered } from '../../stores/currentCourse.svelte';
  import InteractiveFrame from './InteractiveFrame.svelte';

  let { item, isCovered }: { item: InteractiveAppItem; isCovered: boolean } = $props();

  const safe = $derived(safeAppUrl(item.script_url));

  // Coverage + time-on-task. Keyed on item.id (ItemRouter is NOT {#key}-ed, so
  // navigating between two interactive_app items reuses this instance). Capture
  // `id` once so the post-await store write can't target the wrong item after a
  // fast navigation. Read isCovered via untrack: markItemCovered flips the
  // store that feeds the isCovered prop, and without untrack that write would
  // re-invalidate this effect — untrack makes the once-only guarantee hold.
  $effect(() => {
    const id = item.id;
    if (safe === null) return; // unrenderable URL: no tracker, no coverage
    const tracker = createCoverageTracker(id);
    tracker.start();
    if (!untrack(() => isCovered)) {
      void tracker.markCovered().then(() => markItemCovered(id));
    }
    return () => { void tracker.stop(); };
  });
</script>

<article class="interactive-app">
  <h2>{item.title}</h2>
  {#if safe === null}
    <p class="notice">This interactive app can't be displayed.</p>
  {:else}
    <InteractiveFrame src={safe} title={item.title || 'Interactive app'} />
  {/if}
</article>

<style>
  .interactive-app { padding: var(--space-3); }
  .notice { color: var(--muted); font-style: italic; }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/InteractiveAppItem.svelte.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check and commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

```bash
git add frontend/src/components/items/InteractiveAppItem.svelte frontend/src/tests/InteractiveAppItem.svelte.test.ts
git commit -m "feat(frontend): add InteractiveAppItem player with auto-coverage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire `interactive_app` into `ItemRouter`

**Files:**
- Modify: `frontend/src/components/items/ItemRouter.svelte:1-27`
- Test: `frontend/src/tests/ItemRouter.svelte.test.ts`

**Interfaces:**
- Consumes: `<InteractiveAppItem item isCovered />` (Task 3). `ItemRouter` already derives `isCovered` (`ItemRouter.svelte:10`) and receives `{ item: Item; state: VersionState }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/ItemRouter.svelte.test.ts`:

```ts
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
  const state: VersionState = { version_id: 1, items: {} };
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(ItemRouter, { target, props: $state({ item, state }) });
  cleanup = () => unmount(cmp);
  flushSync();
  expect(target.querySelector('iframe')).not.toBeNull();
  expect(target.textContent).not.toContain("isn't available");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/ItemRouter.svelte.test.ts`
Expected: FAIL — `iframe` is null and the `UnsupportedItem` text `"isn't available"` is present (interactive_app still routes to `UnsupportedItem`).

- [ ] **Step 3: Edit `ItemRouter.svelte`**

Add the import after the existing `VideoItem` import (line 5):

```svelte
  import InteractiveAppItem from './InteractiveAppItem.svelte';
```

Replace the `interactive_app` branch (lines 21-22):

```svelte
{:else if item.type === 'interactive_app'}
  <UnsupportedItem type="interactive_app" />
```

with:

```svelte
{:else if item.type === 'interactive_app'}
  <InteractiveAppItem {item} {isCovered} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/ItemRouter.svelte.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Type-check and commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

```bash
git add frontend/src/components/items/ItemRouter.svelte frontend/src/tests/ItemRouter.svelte.test.ts
git commit -m "feat(frontend): route interactive_app to InteractiveAppItem

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Offer `interactive_app` in `ItemTypePicker`

**Files:**
- Modify: `frontend/src/components/editor/ItemTypePicker.svelte:6` (+ new radio)
- Test: `frontend/src/tests/ItemTypePicker.svelte.test.ts` (widen existing + add one test)

**Interfaces:**
- Produces: `type ItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app'`. Consumed by Task 6 (`SequenceAccordion` binds `newType`).

- [ ] **Step 1: Update the existing test's hard-coded type and add a binding test**

In `frontend/src/tests/ItemTypePicker.svelte.test.ts`, widen the `props` type on line 11 from:

```ts
  const props: { value: 'static_page' | 'video' | 'quiz' } = $state({ value: 'static_page' });
```

to:

```ts
  const props: { value: 'static_page' | 'video' | 'quiz' | 'interactive_app' } = $state({ value: 'static_page' });
```

Then append a new test:

```ts
it('offers an interactive_app radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' | 'interactive_app' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const radio = target.querySelector('input[value="interactive_app"]') as HTMLInputElement;
  expect(radio).not.toBeNull();
  radio.click();
  flushSync();
  expect(props.value).toBe('interactive_app');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/ItemTypePicker.svelte.test.ts`
Expected: FAIL — `input[value="interactive_app"]` is null (radio not rendered yet).

- [ ] **Step 3: Edit `ItemTypePicker.svelte`**

Widen the union on line 6:

```ts
  type ItemType = 'static_page' | 'video' | 'quiz' | 'interactive_app';
```

Add a fourth radio after the quiz `<label>` (after line 30, before `</fieldset>`):

```svelte
  <label class:selected={value === 'interactive_app'}>
    <input type="radio" name="item-type" value="interactive_app" bind:group={value} />
    <span class="glyph" aria-hidden="true">🧩</span>
    <span>Interactive app</span>
  </label>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/ItemTypePicker.svelte.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check and commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

```bash
git add frontend/src/components/editor/ItemTypePicker.svelte frontend/src/tests/ItemTypePicker.svelte.test.ts
git commit -m "feat(frontend): offer interactive_app in ItemTypePicker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `SequenceAccordion` create flow for `interactive_app`

**Files:**
- Modify: `frontend/src/components/editor/SequenceAccordion.svelte` (sites listed below)
- Test: `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`

**Interfaces:**
- Consumes: `safeAppUrl` (Task 1); widened `ItemType` / `ItemTypePicker` (Task 5); existing `mapCreateError(e, knownFields)` (keys a 422 by its last string `loc` segment against `knownFields`); existing `DIRTY_REGISTRY_KEY`, `currentEditorVersion`.
- Produces: an `interactive_app` create path that POSTs `{ title, type: 'interactive_app', script_url }` to `/api/sequences/:sid/items`, gated by `createScriptUrlInvalid`.

**Context for the implementer (verified line refs in current `SequenceAccordion.svelte`):** `newType` state @190; `newVideoUrl` @193; `createTracker.isDirty` @208-216; `resetCreateForm` @235-243; `submitCreate` @255-291 (guard @256, body build @261-263, `known` ternary @274-278); video template field @348-353; Create button @355.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts`:

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SequenceAccordion from '../components/editor/SequenceAccordion.svelte';
import { DIRTY_REGISTRY_KEY } from '../lib/dirtyRegistry.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import type { AdminTreeBlock, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

const version: AdminTreeVersion = {
  id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
  max_quiz_attempts: 1, created_at: '2026-01-01T00:00:00Z', published_at: null,
  archived_at: null, content_updated_at: '2026-01-01T00:00:00Z',
};
const seq: AdminTreeSequence = { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [] };
const block: AdminTreeBlock = {
  id: 3, version_id: 1, title: 'Block', slug: 'block', order: 1, info: '', info_html: '',
  sequences: [seq],
};

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  currentEditorVersion.value = {
    course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block],
  };
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
});

function mountAccordion() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const ctx = new Map<symbol, unknown>([[
    DIRTY_REGISTRY_KEY,
    { register: vi.fn(), unregister: vi.fn(), isAnyDirty: () => false },
  ]]);
  const props = $state({
    courseSlug: 'c', vid: 1, block, seq, index: 1, sequenceCount: 1,
    routeBid: '3', routeSid: '2', onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  });
  const cmp = mount(SequenceAccordion, { target, props, context: ctx });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
function openCreateAsApp(target: HTMLElement) {
  // Click "+ New item", then select the interactive_app radio.
  const newBtn = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('New item'))!;
  newBtn.click(); flushSync();
  const radio = target.querySelector('input[value="interactive_app"]') as HTMLInputElement;
  radio.click(); flushSync();
}
const createBtn = (t: HTMLElement) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Create') as HTMLButtonElement;

it('shows the required App URL field when interactive_app is selected', () => {
  const target = mountAccordion();
  openCreateAsApp(target);
  const input = target.querySelector('input[type="url"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  expect(input.required).toBe(true);
});

it('disables Create and issues no POST while the App URL is empty/invalid', async () => {
  const target = mountAccordion();
  openCreateAsApp(target);
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  expect(createBtn(target).disabled).toBe(true);   // empty URL → safeAppUrl('') === null
  createBtn(target).click();
  await settle();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('POSTs script_url when title + a valid URL are present', async () => {
  fetchSpy.mockImplementation(() => jres({ id: 99 }));
  const target = mountAccordion();
  openCreateAsApp(target);
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  const url = target.querySelector('input[type="url"]') as HTMLInputElement;
  url.value = 'https://example.com/app'; url.dispatchEvent(new Event('input')); flushSync();
  createBtn(target).click();
  await settle();
  const post = fetchSpy.mock.calls.find(
    (c) => String(c[0]).includes('/api/sequences/2/items') && (c[1] as RequestInit)?.method === 'POST',
  )!;
  expect(post).toBeTruthy();
  const body = JSON.parse((post[1] as RequestInit).body as string);
  expect(body).toMatchObject({ type: 'interactive_app', title: 'My app', script_url: 'https://example.com/app' });
});

it('maps a backend 422 on script_url to an inline field error', async () => {
  fetchSpy.mockImplementation(() => jres(
    { detail: [{ loc: ['body', 'script_url'], msg: 'must be http(s)', type: 'value_error' }] }, 422,
  ));
  const target = mountAccordion();
  openCreateAsApp(target);
  const title = target.querySelector('input[placeholder="Title"]') as HTMLInputElement;
  title.value = 'My app'; title.dispatchEvent(new Event('input')); flushSync();
  const url = target.querySelector('input[type="url"]') as HTMLInputElement;
  url.value = 'https://example.com/app'; url.dispatchEvent(new Event('input')); flushSync();
  createBtn(target).click();
  await settle();
  expect(target.textContent).toContain('must be http(s)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/SequenceAccordion.interactive.svelte.test.ts`
Expected: FAIL — the interactive_app radio doesn't exist / the App URL field doesn't render / no `script_url` in the POST body.

- [ ] **Step 3: Edit `SequenceAccordion.svelte` — script + logic**

Add the import near the other lib imports (after line 8, `mapCreateError`):

```ts
  import { safeAppUrl } from '../../lib/safeAppUrl';
```

Widen `newType` (line 190):

```ts
  let newType = $state<'static_page' | 'video' | 'quiz' | 'interactive_app'>('static_page');
```

Add `newScriptUrl` state after `newVideoUrl` (line 193):

```ts
  let newScriptUrl = $state('');
```

Add the dirty arm inside `createTracker.isDirty` — extend the `||` chain (lines 211-214) so it ends:

```ts
        (newType === 'video' && newVideoUrl.trim() !== '') ||
        (newType === 'interactive_app' && newScriptUrl.trim() !== '')
```

Add a derived gate after the `createTracker` declaration (after line 216):

```ts
  // Create is gated on a renderable URL (a deliberate divergence from video):
  // auto-coverage makes a stored-but-unrenderable URL an uncoverable required
  // item, and there is no publish-time preflight to catch it later. safeAppUrl
  // also rejects http:// on an https:// page (mixed content).
  const createScriptUrlInvalid = $derived(
    newType === 'interactive_app' && safeAppUrl(newScriptUrl) === null,
  );
```

Reset `newScriptUrl` in `resetCreateForm` (add after the `newVideoUrl = '';` line, ~line 239):

```ts
    newScriptUrl = '';
```

In `submitCreate`, add a defensive pre-POST bail right after the existing guard line (after line 256, `if (createBusy || …) return;`):

```ts
    if (newType === 'interactive_app' && safeAppUrl(newScriptUrl) === null) {
      createErrors = { ...createErrors, script_url: 'A valid http(s) app URL is required' };
      return;
    }
```

Add the body line after the video body line (after line 263):

```ts
    if (newType === 'interactive_app') body.script_url = newScriptUrl;
```

Add an explicit `known`-fields arm. Replace the ternary (lines 274-278):

```ts
      const known = newType === 'static_page'
        ? ['title', 'content_md', 'type']
        : newType === 'video'
          ? ['title', 'video_url', 'type']
          : ['title', 'type'];
```

with:

```ts
      const known = newType === 'static_page'
        ? ['title', 'content_md', 'type']
        : newType === 'video'
          ? ['title', 'video_url', 'type']
          : newType === 'interactive_app'
            ? ['title', 'script_url', 'type']
            : ['title', 'type'];
```

- [ ] **Step 4: Edit `SequenceAccordion.svelte` — template**

Add the App URL field after the video `{:else if}` block (after line 353, before `{#if createGlobalError}`):

```svelte
            {:else if newType === 'interactive_app'}
              <div class="field">
                <input type="url" placeholder="App URL (https://…)" bind:value={newScriptUrl} required disabled={createBusy || busy || parentBusy} oninput={() => { if (createErrors.script_url) createErrors = { ...createErrors, script_url: '' }; }} />
                {#if createErrors.script_url}<small class="field-err">{createErrors.script_url}</small>{/if}
              </div>
```

Add `createScriptUrlInvalid` to the Create button's `disabled` and a tooltip. Replace the Create button (line 355):

```svelte
            <Button type="submit" disabled={tracker.isDirty || createBusy || busy || parentBusy || !canStructure || !newTitle.trim()} loading={createBusy}>Create</Button>
```

with:

```svelte
            <Button type="submit" disabled={tracker.isDirty || createBusy || busy || parentBusy || !canStructure || !newTitle.trim() || createScriptUrlInvalid} title={createScriptUrlInvalid ? 'A valid http(s) app URL is required' : ''} loading={createBusy}>Create</Button>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/SequenceAccordion.interactive.svelte.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Type-check, run the full editor suite, commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

Run: `cd frontend && npx vitest run src/tests/ItemTypePicker.svelte.test.ts src/tests/SequenceAccordion.interactive.svelte.test.ts`
Expected: PASS (no regression in the picker).

```bash
git add frontend/src/components/editor/SequenceAccordion.svelte frontend/src/tests/SequenceAccordion.interactive.svelte.test.ts
git commit -m "feat(frontend): SequenceAccordion create flow for interactive_app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `ItemEditPage` edit + read-only preview for `interactive_app`

**Files:**
- Modify: `frontend/src/pages/editor/ItemEditPage.svelte` (sites listed below)
- Test: `frontend/src/tests/ItemEditPage.interactive.svelte.test.ts`

**Interfaces:**
- Consumes: `safeAppUrl` (Task 1); `<InteractiveFrame src title />` (Task 2); existing `makeDirtyTracker`, `currentEditorVersion`, `versionPermissions` (`canEditTextFields = created || published`).
- Produces: full interactive_app editing — editable form with debounced live preview, `safeAppUrl`-gated Save, read-only preview on disabled/archived versions.

**Context (verified line refs in current `ItemEditPage.svelte`):** imports @1-17; `editable` @45; tracker type union @50-53; `videoUrlEmpty` @72-76; `videoPreviewUrl` $effect @85-96; `readonlyVideoPreviewUrl` @102-104; `ensureLoaded` tracker seed @125-127; `save()` body build @147-164, post-ok reset @180-186, post-error reset @192-197; `discard()` @213-215; edit template region @273-303 (Save button @295-300); read-only region @304-328; final `{:else}` note @341-347.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/ItemEditPage.interactive.svelte.test.ts`:

```ts
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import ItemEditPage from '../pages/editor/ItemEditPage.svelte';
import { currentEditorVersion } from '../stores/currentEditorVersion.svelte';
import * as assetsModule from '../lib/assets';
import type { AdminTreeBlock, AdminTreeItem, AdminTreeSequence, AdminTreeVersion } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;
function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); await tick(); }

function makeVersion(over: Partial<AdminTreeVersion> = {}): AdminTreeVersion {
  return {
    id: 1, course_id: 1, state: 'created', is_disabled: false, info_md: '', info_html: '',
    max_quiz_attempts: 1, created_at: '2026-01-01T00:00:00Z', published_at: null,
    archived_at: null, content_updated_at: '2026-01-01T00:00:00Z', ...over,
  };
}
const appItem: AdminTreeItem = {
  id: 7, sequence_id: 2, title: 'App', slug: 'app', order: 1, type: 'interactive_app',
  content_md: null, content_html: null, video_url: null,
  script_url: 'https://example.com/app', questions_count: 0,
};
function seedTree(version: AdminTreeVersion, item: AdminTreeItem = appItem) {
  const seq: AdminTreeSequence = { id: 2, block_id: 3, title: 'Seq', slug: 'seq', order: 1, items: [item] };
  const block: AdminTreeBlock = {
    id: 3, version_id: version.id, title: 'Block', slug: 'block', order: 1, info: '', info_html: '',
    sequences: [seq],
  };
  currentEditorVersion.value = { course: { id: 1, name: 'C', slug: 'c' }, version, blocks: [block] };
}

let cleanup: (() => void) | null = null;
beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation(() => jres({}));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.spyOn(assetsModule, 'listAssets').mockResolvedValue([]);
});
afterEach(() => {
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  currentEditorVersion.value = null;
  vi.restoreAllMocks();
});

async function mountPage() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({
    courseSlug: 'c', versionId: '1', blockId: '3', sequenceId: '2', itemId: '7',
  });
  const cmp = mount(ItemEditPage, { target, props });
  cleanup = () => unmount(cmp);
  await settle();
  return target;
}
const saveBtn = (t: HTMLElement) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
const urlInput = (t: HTMLElement) => t.querySelector('input[type="url"]') as HTMLInputElement;

it('renders an editable App URL form on a created version', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  expect(urlInput(target)).not.toBeNull();
});

it('disables Save when the URL is invalid and enables it when valid', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  const u = urlInput(target);
  u.value = ''; u.dispatchEvent(new Event('input')); flushSync();
  expect(saveBtn(target).disabled).toBe(true);            // safeAppUrl('') === null
  u.value = 'https://example.com/changed'; u.dispatchEvent(new Event('input')); flushSync();
  expect(saveBtn(target).disabled).toBe(false);
});

it('PATCHes script_url on save', async () => {
  seedTree(makeVersion());
  const target = await mountPage();
  const u = urlInput(target);
  u.value = 'https://example.com/changed'; u.dispatchEvent(new Event('input')); flushSync();
  saveBtn(target).click();
  await settle();
  const patch = fetchSpy.mock.calls.find(
    (c) => String(c[0]).includes('/api/items/7') && (c[1] as RequestInit)?.method === 'PATCH',
  )!;
  expect(patch).toBeTruthy();
  expect(JSON.parse((patch[1] as RequestInit).body as string)).toMatchObject({ script_url: 'https://example.com/changed' });
});

it('allows editing on a published version', async () => {
  seedTree(makeVersion({ state: 'published', published_at: '2026-02-01T00:00:00Z' }));
  const target = await mountPage();
  expect(urlInput(target)).not.toBeNull();
});

it('renders a read-only preview (not a blank box) on a disabled version', async () => {
  seedTree(makeVersion({ is_disabled: true }));
  const target = await mountPage();
  expect(urlInput(target)).toBeNull();                    // no edit form
  expect(target.querySelector('iframe')).not.toBeNull();  // read-only InteractiveFrame
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/ItemEditPage.interactive.svelte.test.ts`
Expected: FAIL — interactive_app is not in `editable`, so no edit form / read-only preview renders (the page falls into the "Not editable in this slice" branch).

- [ ] **Step 3: Edit `ItemEditPage.svelte` — imports + types + editable**

Add the import after the `VideoFrame` import (line 11):

```ts
  import InteractiveFrame from '../../components/items/InteractiveFrame.svelte';
```

Add `safeAppUrl` after the `safeIframeUrl` import (line 15):

```ts
  import { safeAppUrl } from '../../lib/safeAppUrl';
```

Add `interactive_app` to `editable` (line 45):

```ts
  const editable = $derived(item?.type === 'static_page' || item?.type === 'video' || item?.type === 'interactive_app');
```

Add the form type after `VideoForm` (line 51) and a third union arm (lines 52-53):

```ts
  type StaticForm = { title: string; content_md: string };
  type VideoForm = { title: string; video_url: string };
  type InteractiveAppForm = { title: string; script_url: string };
  let tracker = $state<ReturnType<typeof makeDirtyTracker<StaticForm>>
                     | ReturnType<typeof makeDirtyTracker<VideoForm>>
                     | ReturnType<typeof makeDirtyTracker<InteractiveAppForm>> | null>(null);
```

- [ ] **Step 4: Edit `ItemEditPage.svelte` — Save gate + previews**

Add `scriptUrlInvalid` after the `videoUrlEmpty` derived (after line 76):

```ts
  // Block save unless safeAppUrl accepts the URL (empty, no-host, non-http(s),
  // or http:// on an https:// page). Stricter than videoUrlEmpty because
  // coverage depends on the app actually rendering.
  const scriptUrlInvalid = $derived(
    item?.type === 'interactive_app' && tracker
      ? safeAppUrl((tracker.current as InteractiveAppForm).script_url) === null
      : false,
  );
```

Add the debounced live preview after the `videoPreviewUrl` `$effect` (after line 96):

```ts
  // Debounced live preview for the interactive-app editor. No normalizeVideoUrl
  // (that is video-only). safeAppUrl blanks an http://-on-https:// URL, giving
  // the admin a visible "won't work for students" signal.
  let scriptPreviewUrl = $state<string | null>(null);
  $effect(() => {
    if (item?.type !== 'interactive_app' || !tracker) {
      scriptPreviewUrl = null;
      return;
    }
    const raw = (tracker.current as InteractiveAppForm).script_url;
    const handle = setTimeout(() => {
      scriptPreviewUrl = safeAppUrl(raw);
    }, 500);
    return () => clearTimeout(handle);
  });
```

Add the readonly preview derived after `readonlyVideoPreviewUrl` (after line 104):

```ts
  const readonlyScriptPreviewUrl = $derived(
    item?.type === 'interactive_app' ? safeAppUrl(item.script_url ?? '') : null,
  );
```

- [ ] **Step 5: Edit `ItemEditPage.svelte` — ensureLoaded / save / discard**

In `ensureLoaded`, add the tracker seed arm after the video arm (after line 126):

```ts
      else if (fresh.type === 'interactive_app') tracker = makeDirtyTracker<InteractiveAppForm>({ title: fresh.title, script_url: fresh.script_url ?? '' });
```

(The existing `else tracker = null;` on line 127 stays — its comment can drop the "interactive_app → read-only" note, but that is cosmetic.)

In `save()`, add a `sentScriptUrl` declaration beside `sentVideoUrl` (after line 146):

```ts
    let sentScriptUrl: string | undefined;
```

Add the body-build arm after the video `else if` block closes (after line 164, the `}` that ends the `else if (savedItemType === 'video')`):

```ts
    } else if (savedItemType === 'interactive_app') {
      sentScriptUrl = (savedTracker.current as InteractiveAppForm).script_url;
      // Defensive: Save is also disabled in this state, but a programmatic
      // invocation could bypass that. safeAppUrl rejects empty/no-host/
      // non-http(s)/http-on-https — none of which can be auto-covered.
      if (safeAppUrl(sentScriptUrl) === null) {
        pushToast('A valid app URL is required', 'error');
        return;
      }
      body.script_url = sentScriptUrl;
    }
```

Add the post-ok reset arm after the video reset (after line 184, inside the `if (fresh && fresh.type === savedItemType)` block):

```ts
          } else if (savedItemType === 'interactive_app') {
            (savedTracker as ReturnType<typeof makeDirtyTracker<InteractiveAppForm>>).reset({ title: fresh.title, script_url: fresh.script_url ?? '' });
```

Add the post-error baseline reset after the video one (after line 196):

```ts
        } else if (savedItemType === 'interactive_app') {
          (savedTracker as ReturnType<typeof makeDirtyTracker<InteractiveAppForm>>).reset({ title: sentTitle, script_url: sentScriptUrl ?? '' });
```

In `discard()`, add the arm after the video one (after line 215):

```ts
    else if (item.type === 'interactive_app') (tracker as ReturnType<typeof makeDirtyTracker<InteractiveAppForm>>).reset({ title: item.title, script_url: item.script_url ?? '' });
```

- [ ] **Step 6: Edit `ItemEditPage.svelte` — edit template branch + Save gate**

In the editable region, the type-discriminant chain currently ends like this (the `{/if}` closes the `{#if item.type === 'static_page'} … {:else if item.type === 'video'}` chain, then the shared `<div class="row">` with Save/Discard follows):

```svelte
          {#if videoPreviewUrl}
            <VideoFrame src={videoPreviewUrl} title={t.current.title || 'Video preview'} />
          {/if}
        {/if}
        <div class="row">
```

Insert the `interactive_app` arm as a NEW `{:else if}` in that chain — between the video block's closing `{#if videoPreviewUrl}…{/if}` and the chain-closing `{/if}` (it must stay INSIDE the `{#if item.type …}` chain, not after it):

```svelte
          {#if videoPreviewUrl}
            <VideoFrame src={videoPreviewUrl} title={t.current.title || 'Video preview'} />
          {/if}
        {:else if item.type === 'interactive_app'}
          {@const t = tracker as ReturnType<typeof makeDirtyTracker<InteractiveAppForm>>}
          <label>App URL
            <input type="url" bind:value={t.current.script_url} required placeholder="https://…" />
          </label>
          {#if scriptPreviewUrl}
            <InteractiveFrame src={scriptPreviewUrl} title={t.current.title || 'Interactive app'} />
          {/if}
        {/if}
        <div class="row">
```

Update the shared Save button (lines 295-300) to OR in `scriptUrlInvalid` and compose the tooltip:

```svelte
          <Button
            onclick={save}
            disabled={!tracker.isDirty || busy || videoUrlEmpty || scriptUrlInvalid}
            loading={busy}
            title={videoUrlEmpty ? 'Video URL is required' : scriptUrlInvalid ? 'A valid http(s) app URL is required' : ''}
          >Save</Button>
```

- [ ] **Step 7: Edit `ItemEditPage.svelte` — read-only branch + remove slice-2 note**

In the read-only region (`<section class="readonly">`), the type-discriminant chain currently ends like this (the inner `{/if}` closes the video URL conditional; the outer `{/if}` closes the `{#if item.type === 'static_page'} … {:else if item.type === 'video'}` chain; then `</section>`):

```svelte
          {:else}
            <p><em>No video URL</em></p>
          {/if}
        {/if}
      </section>
```

Insert the `interactive_app` arm as a NEW `{:else if}` in that chain — between the video block's inner closing `{/if}` and the chain-closing `{/if}` (INSIDE the `{#if item.type …}` chain):

```svelte
          {:else}
            <p><em>No video URL</em></p>
          {/if}
        {:else if item.type === 'interactive_app'}
          <h3>{item.title}</h3>
          {#if readonlyScriptPreviewUrl}
            <InteractiveFrame src={readonlyScriptPreviewUrl} title={item.title} />
            <p><a href={readonlyScriptPreviewUrl} target="_blank" rel="noopener noreferrer">{readonlyScriptPreviewUrl}</a></p>
          {:else if item.script_url}
            <p><a href={item.script_url} target="_blank" rel="noopener noreferrer">{item.script_url}</a></p>
          {:else}
            <p><em>No app URL</em></p>
          {/if}
        {/if}
      </section>
```

Replace the final `{:else}` note (lines 341-347):

```svelte
    {:else}
      <section class="readonly">
        <p><em>Not editable in this slice.</em></p>
        {#if item.type === 'interactive_app'}
          <p>Interactive-app editing lands in slice 2.</p>
        {/if}
      </section>
    {/if}
```

with (the branch is now unreachable for all four `AdminTreeItem` types — keep a minimal defensive fallback):

```svelte
    {:else}
      <section class="readonly">
        <p><em>Not editable.</em></p>
      </section>
    {/if}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/tests/ItemEditPage.interactive.svelte.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Type-check, run the editor regression set, commit**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors.

Run: `cd frontend && npx vitest run src/tests/ItemEditPage.refreshKey.svelte.test.ts src/tests/ItemEditPage.interactive.svelte.test.ts`
Expected: PASS (no regression in the existing ItemEditPage test).

```bash
git add frontend/src/pages/editor/ItemEditPage.svelte frontend/src/tests/ItemEditPage.interactive.svelte.test.ts
git commit -m "feat(frontend): ItemEditPage edit + readonly preview for interactive_app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the entire frontend test suite**

Run: `cd frontend && npm test`
Expected: all tests pass (the pre-existing suite was 1095 green at the last merge; this adds ~19 new tests across Tasks 1-7 — expect ~1114, zero failures). The one known pre-existing TZ-pinned file is npm-test-only and unaffected.

- [ ] **Step 2: Final type-check**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors, 0 warnings beyond the pre-existing `state_referenced_locally` once-seed reads.

- [ ] **Step 3: Manual smoke (human-run, deferred to branch finish)**

Defer to the manual smoke pass at branch finish: (1) create an interactive_app item with a valid `https://` URL → renders in the student view, sidebar marks it covered on open; (2) edit the URL on a published version → live preview updates, Save persists; (3) an unsafe/blank URL → "can't be displayed" notice, not covered; (4) ItemTypePicker shows the 🧩 option. No commit (verification task).

---

## Notes for the executor

- **Backend is untouched.** If any step seems to require a backend change, stop — the spec is frontend-only and the backend already supports `script_url` end-to-end.
- **`safeAppUrl` vs `safeIframeUrl`:** every interactive_app surface uses `safeAppUrl`; `video` keeps `safeIframeUrl`. Do not "unify" them.
- **jsdom page protocol is `http:`**, so `https://` fixtures pass the mixed-content guard in component tests; the http-on-https rejection is unit-tested in Task 1 only.
- **Minor findings ledger:** none carried in from the spec review (codex APPROVE clean). Record any new Minors in `.superpowers/sdd/progress.md` for the final whole-branch review.
