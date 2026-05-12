# Editor Accordion Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 4-page admin editor (Versions → Version → Block → Sequence → Item) into a single VersionEditPage with a 2-level accordion (blocks → sequences). Item editing stays on its own page.

**Architecture:** Svelte 5 runes throughout. Three routes (`/v/:vid`, `/blocks/:bid`, `/sequences/:sid`) all render the same VersionEditPage component — accordion expansion is derived directly from URL route params (no parallel state). Per-form dirty trackers register into a page-wide `SvelteSet` registry via `setContext`/`getContext` symbol key; DirtyGuard reads `() => isAnyDirty()` so its closure re-evaluates on every navigation. Stale-id fallback toasts + history-replaces to the nearest valid parent. Focus + scroll on deep-link / Back-Forward, but click-to-expand keeps focus on the clicked toggle (discriminator: compare `document.activeElement?.id` against the deepest expanded `headerId`). Reorder ownership flows down: the list-owning parent (VersionEditPage owns block reorder, BlockAccordion owns sequence reorder, SequenceAccordion owns item reorder) holds the API call; child components receive `onMoveUp` / `onMoveDown` callbacks.

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$props`, `$effect`, `$bindable`), TypeScript, Vite, vitest (no `@testing-library/svelte`; component-level behavior covered by manual smoke checklist). `svelte/reactivity` for `SvelteSet`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-10-editor-accordion-design.md` (slice 2, branch `frontend-admin-editor-accordion`).

**Working directory:** `/Users/svkucheryavski/Documents/Developing/mathion/frontend/`. All `npm` commands run from that directory.

**Test/check commands:**
- `npm test` — run vitest suite once
- `npm run check` — run svelte-check (type check)
- `npm run dev` — dev server for smoke checks

**Slice-1 conventions to use VERBATIM (verified at plan-writing time):**
- Toasts: `import { pushToast } from '../../stores/toasts.svelte';` called as `pushToast(msg, 'success'|'info'|'error')`. There is **no** `toasts` named export in `lib/events.ts`.
- Permissions: `import { versionPermissions } from '../../lib/versionPermissions';` then `const perms = $derived(v ? versionPermissions(v) : null);` and read `perms.canEditTextFields`, `perms.canEditStructure`, `perms.canEditVersionMeta`, `perms.canPublish`, `perms.canArchive`, `perms.canRevert`, `perms.canDisable`, `perms.canEnable`, `perms.canDeleteVersion`. **There is no `canEditTextFields(v)` callable** — only the factory.
- Error mapping: `import { mapCreateError, type FieldErrors } from '../../lib/formErrors';` called as `mapCreateError(e, ['title','slug'])`; returns `{ fieldErrors: FieldErrors, globalMessage: string | null }`. On global-only errors slice-1 also toasts: `if (mapped.globalMessage && Object.keys(mapped.fieldErrors).length === 0) pushToast(mapped.globalMessage, 'error');`.
- Save 3-way LoadResult: every PATCH save follows the slice-1 pattern — `result === 'discarded'` → `pushToast('Saved', 'success')` and skip reset; `result === 'ok'` → reset against fresh server values + `pushToast('Saved', 'success')`; `result === 'error'` → reset against the sent values + `pushToast('Saved (refresh failed — reload to see latest)', 'info')`.
- Reorder/delete recovery: on error, `await loadAdminTree(savedVid, { force: true });` to re-derive permissions.
- Endpoint shapes (verified): block create `POST /api/versions/${vid}/blocks { title, slug, info: '' }`; sequence create `POST /api/blocks/${bid}/sequences { title, slug }`; item create `POST /api/sequences/${sid}/items { title, slug, type, content_md? | video_url? }`; reorder POSTs use `{ order: [{id, order}, ...] }`.
- Slug inputs: `required pattern="[a-z0-9]+(-[a-z0-9]+)*"` (matches backend regex).
- Block has `info: string` (NOT `info_md`). See `lib/types.ts:251`.
- `AdminTree.course` is `{ id: number; name: string; slug: string }`. See `lib/types.ts:257`.
- `ItemTypePicker` narrows to `'static_page' | 'video'`. Per-type required fields: `content_md` (textarea, auto-seed `# {title}\n`) for static_page; `video_url` (`type="url"`) for video.
- Page header structure: `<Button variant="ghost" onclick={...back...}>← Versions</Button>` + `<h1>{tree.course.name} · v{v.id} <span class="state state-{v.state}">{v.state}</span>{#if v.is_disabled}<span class="state disabled">disabled</span>{/if}</h1>` + disabled banner.

---

## File map

**New files:**
- `frontend/src/lib/labelFor.ts` — pure helper: title→slug→fallback chain
- `frontend/src/tests/labelFor.test.ts` — vitest coverage
- `frontend/src/lib/deriveExpansion.ts` — pure: lookup `(bid, sid, tree)` → entities + stale flags
- `frontend/src/tests/deriveExpansion.test.ts`
- `frontend/src/lib/dirtyRegistry.svelte.ts` — `createDirtyRegistry`, `DIRTY_REGISTRY_KEY`, types
- `frontend/src/tests/dirtyRegistry.test.ts`
- `frontend/src/lib/handleStaleIdFallback.ts` — pure side-effect dispatch (injected `pushToast` + `navigate`)
- `frontend/src/tests/handleStaleIdFallback.test.ts`
- `frontend/src/components/editor/VersionMetaForm.svelte` — extracted version-meta editor
- `frontend/src/components/editor/AccordionHeader.svelte` — pure presentational header
- `frontend/src/components/editor/ItemRow.svelte` — one item row (callbacks only)
- `frontend/src/components/editor/SequenceAccordion.svelte` — one sequence (owns item list)
- `frontend/src/components/editor/BlockAccordion.svelte` — one block (owns sequence list)

**Modified files:**
- `frontend/src/components/editor/DirtyGuard.svelte` — one-line copy update
- `frontend/src/pages/editor/VersionEditPage.svelte` — full rewrite: provider + accordion list + effects + block-reorder + state-actions
- `frontend/src/routes.ts` — rebind 3 routes to `'VersionEditPage'`
- `frontend/src/App.svelte` — remove `BlockEditPage` / `SequenceEditPage` imports + componentMap entries

**Deleted files:**
- `frontend/src/pages/editor/BlockEditPage.svelte`
- `frontend/src/pages/editor/SequenceEditPage.svelte`

---

## Task 1: Pure helper — `labelFor`

**Files:**
- Create: `frontend/src/lib/labelFor.ts`
- Create: `frontend/src/tests/labelFor.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `frontend/src/tests/labelFor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { labelFor } from '../lib/labelFor';

describe('labelFor', () => {
  it('returns title when non-empty', () => {
    expect(labelFor('Linear Algebra', 'lin-alg')).toBe('Linear Algebra');
  });

  it('falls back to slug when title is empty', () => {
    expect(labelFor('', 'intro-1')).toBe('intro-1');
  });

  it('falls back to slug when title is whitespace-only', () => {
    expect(labelFor('   ', 'intro-1')).toBe('intro-1');
  });

  it('falls back to provided positional fallback when both empty', () => {
    expect(labelFor('', '', 'block 3')).toBe('block 3');
  });

  it('falls back to provided positional fallback when both whitespace', () => {
    expect(labelFor('  ', '  ', 'item 5')).toBe('item 5');
  });

  it('returns "untitled" when all empty and no fallback supplied', () => {
    expect(labelFor('', '')).toBe('untitled');
  });

  it('handles null inputs gracefully', () => {
    expect(labelFor(null, null, 'sequence 2')).toBe('sequence 2');
  });

  it('handles undefined inputs gracefully', () => {
    expect(labelFor(undefined, undefined)).toBe('untitled');
  });

  it('trims surrounding whitespace from title', () => {
    expect(labelFor('  Vectors  ', '')).toBe('Vectors');
  });

  it('trims surrounding whitespace from slug', () => {
    expect(labelFor('', '  intro-1  ')).toBe('intro-1');
  });

  it('item-flavored case: empty title, non-empty slug, item fallback', () => {
    expect(labelFor('  ', 'worked-example-3', 'item 5')).toBe('worked-example-3');
  });

  it('whitespace-only fallback also falls through to "untitled"', () => {
    expect(labelFor('', '', '   ')).toBe('untitled');
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- labelFor
```

Expected: All tests FAIL with "Failed to resolve import '../lib/labelFor'".

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/lib/labelFor.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- labelFor
```

Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/labelFor.ts frontend/src/tests/labelFor.test.ts
git commit -m "feat(frontend): add labelFor helper for accordion a11y labels"
```

---

## Task 2: Pure helper — `deriveExpansion`

**Files:**
- Create: `frontend/src/lib/deriveExpansion.ts`
- Create: `frontend/src/tests/deriveExpansion.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `frontend/src/tests/deriveExpansion.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveExpansion } from '../lib/deriveExpansion';
import type { AdminTree } from '../lib/types';

function makeTree(): AdminTree {
  return {
    course: { id: 1, name: 'CS 101', slug: 'cs101' },
    version: {
      id: 10,
      course_id: 1,
      state: 'created',
      is_disabled: false,
      info_md: '',
      info_html: '',
      max_quiz_attempts: 3,
      created_at: '2026-05-01T00:00:00Z',
      published_at: null,
      archived_at: null,
      content_updated_at: '2026-05-01T00:00:00Z',
    },
    blocks: [
      {
        id: 100,
        version_id: 10,
        title: 'B1',
        slug: 'b1',
        order: 1,
        info: '',
        info_html: '',
        sequences: [
          { id: 1000, block_id: 100, title: 'S1', slug: 's1', order: 1, items: [] },
          { id: 1001, block_id: 100, title: 'S2', slug: 's2', order: 2, items: [] },
        ],
      },
      {
        id: 101,
        version_id: 10,
        title: 'B2',
        slug: 'b2',
        order: 2,
        info: '',
        info_html: '',
        sequences: [
          { id: 1002, block_id: 101, title: 'S3', slug: 's3', order: 1, items: [] },
        ],
      },
    ],
  };
}

describe('deriveExpansion', () => {
  it('returns null entities when bid and sid are null', () => {
    const r = deriveExpansion(null, null, makeTree());
    expect(r.expandedBlock).toBeNull();
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });

  it('returns block when bid matches', () => {
    const r = deriveExpansion('100', null, makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });

  it('returns block AND sequence when both match', () => {
    const r = deriveExpansion('100', '1001', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence?.id).toBe(1001);
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });

  it('flags staleBid when bid does not match any block', () => {
    const r = deriveExpansion('999', null, makeTree());
    expect(r.expandedBlock).toBeNull();
    expect(r.staleBid).toBe(true);
    expect(r.staleSid).toBe(false);
  });

  it('flags staleSid when bid matches but sid does not match inside that block', () => {
    const r = deriveExpansion('100', '9999', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(true);
  });

  it('flags staleSid when sid matches a sequence in a different block', () => {
    const r = deriveExpansion('100', '1002', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence).toBeNull();
    expect(r.staleSid).toBe(true);
  });

  it('flags only staleBid (not staleSid) when both ids miss — caller cascades', () => {
    const r = deriveExpansion('999', '1001', makeTree());
    expect(r.expandedBlock).toBeNull();
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(true);
    expect(r.staleSid).toBe(false);
  });

  it('compares by string equality against String(block.id)', () => {
    const r = deriveExpansion('100', '1000', makeTree());
    expect(r.expandedBlock?.id).toBe(100);
    expect(r.expandedSequence?.id).toBe(1000);
  });

  it('handles null tree (load not yet complete) — both stale flags false, null entities', () => {
    const r = deriveExpansion('100', '1000', null);
    expect(r.expandedBlock).toBeNull();
    expect(r.expandedSequence).toBeNull();
    expect(r.staleBid).toBe(false);
    expect(r.staleSid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- deriveExpansion
```

Expected: FAIL with "Failed to resolve import '../lib/deriveExpansion'".

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/lib/deriveExpansion.ts`:

```typescript
import type { AdminTree, AdminTreeBlock, AdminTreeSequence } from './types';

export type Expansion = {
  expandedBlock: AdminTreeBlock | null;
  expandedSequence: AdminTreeSequence | null;
  staleBid: boolean;
  staleSid: boolean;
};

export function deriveExpansion(
  bid: string | null,
  sid: string | null,
  tree: AdminTree | null,
): Expansion {
  if (!tree) {
    return { expandedBlock: null, expandedSequence: null, staleBid: false, staleSid: false };
  }
  if (bid === null) {
    return { expandedBlock: null, expandedSequence: null, staleBid: false, staleSid: false };
  }
  const expandedBlock = tree.blocks.find((b) => String(b.id) === bid) ?? null;
  if (!expandedBlock) {
    return { expandedBlock: null, expandedSequence: null, staleBid: true, staleSid: false };
  }
  if (sid === null) {
    return { expandedBlock, expandedSequence: null, staleBid: false, staleSid: false };
  }
  const expandedSequence = expandedBlock.sequences.find((s) => String(s.id) === sid) ?? null;
  if (!expandedSequence) {
    return { expandedBlock, expandedSequence: null, staleBid: false, staleSid: true };
  }
  return { expandedBlock, expandedSequence, staleBid: false, staleSid: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- deriveExpansion
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/deriveExpansion.ts frontend/src/tests/deriveExpansion.test.ts
git commit -m "feat(frontend): add deriveExpansion helper for URL→accordion derivation"
```

---

## Task 3: Pure helper — `dirtyRegistry`

**Files:**
- Create: `frontend/src/lib/dirtyRegistry.svelte.ts`
- Create: `frontend/src/tests/dirtyRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `frontend/src/tests/dirtyRegistry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type RegisteredTracker } from '../lib/dirtyRegistry.svelte';

// Fake tracker matching RegisteredTracker shape (readonly isDirty getter).
function fakeTracker(initial: boolean): RegisteredTracker & { setDirty(v: boolean): void } {
  let d = initial;
  return {
    get isDirty() { return d; },
    setDirty(v) { d = v; },
  };
}

describe('dirtyRegistry', () => {
  it('exports a symbol context key', () => {
    expect(typeof DIRTY_REGISTRY_KEY).toBe('symbol');
  });

  it('factory returns object with register / unregister / isAnyDirty', () => {
    const r = createDirtyRegistry();
    expect(typeof r.register).toBe('function');
    expect(typeof r.unregister).toBe('function');
    expect(typeof r.isAnyDirty).toBe('function');
  });

  it('empty registry returns isAnyDirty = false', () => {
    const r = createDirtyRegistry();
    expect(r.isAnyDirty()).toBe(false);
  });

  it('one clean tracker → isAnyDirty = false', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(false));
    expect(r.isAnyDirty()).toBe(false);
  });

  it('one dirty tracker → isAnyDirty = true', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(true));
    expect(r.isAnyDirty()).toBe(true);
  });

  it('multiple trackers OR correctly (any-dirty wins)', () => {
    const r = createDirtyRegistry();
    r.register(fakeTracker(false));
    r.register(fakeTracker(false));
    r.register(fakeTracker(true));
    expect(r.isAnyDirty()).toBe(true);
  });

  it('reads tracker.isDirty getter on EACH iterate call (not cached)', () => {
    const r = createDirtyRegistry();
    const t = fakeTracker(false);
    r.register(t);
    expect(r.isAnyDirty()).toBe(false);
    t.setDirty(true);
    expect(r.isAnyDirty()).toBe(true);
    t.setDirty(false);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('unregister removes a tracker — register/unregister symmetric', () => {
    const r = createDirtyRegistry();
    const dirtyT = fakeTracker(true);
    r.register(dirtyT);
    expect(r.isAnyDirty()).toBe(true);
    r.unregister(dirtyT);
    expect(r.isAnyDirty()).toBe(false);
  });

  it('unregister of unknown tracker is a no-op (does not throw)', () => {
    const r = createDirtyRegistry();
    const stranger = fakeTracker(true);
    expect(() => r.unregister(stranger)).not.toThrow();
    expect(r.isAnyDirty()).toBe(false);
  });

  it('add-then-remove sequence returns to clean', () => {
    const r = createDirtyRegistry();
    const t1 = fakeTracker(true);
    const t2 = fakeTracker(true);
    r.register(t1);
    r.register(t2);
    expect(r.isAnyDirty()).toBe(true);
    r.unregister(t1);
    expect(r.isAnyDirty()).toBe(true); // t2 still dirty
    r.unregister(t2);
    expect(r.isAnyDirty()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- dirtyRegistry
```

Expected: FAIL with "Failed to resolve import '../lib/dirtyRegistry.svelte'".

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/lib/dirtyRegistry.svelte.ts`:

```typescript
import { SvelteSet } from 'svelte/reactivity';

// Erased shape: the registry stores trackers across all form shapes.
// The concrete tracker types still flow through their owning form; only
// the registry needs to forget the parameter.
export type RegisteredTracker = { readonly isDirty: boolean };

export const DIRTY_REGISTRY_KEY = Symbol('dirtyRegistry');

export type DirtyRegistry = {
  register(t: RegisteredTracker): void;
  unregister(t: RegisteredTracker): void;
  isAnyDirty(): boolean;
};

export function createDirtyRegistry(): DirtyRegistry {
  const registry = new SvelteSet<RegisteredTracker>();
  return {
    register(t)   { registry.add(t); },
    unregister(t) { registry.delete(t); },
    isAnyDirty() {
      for (const t of registry) if (t.isDirty) return true;
      return false;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- dirtyRegistry
```

Expected: All 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/dirtyRegistry.svelte.ts frontend/src/tests/dirtyRegistry.test.ts
git commit -m "feat(frontend): add dirtyRegistry for page-wide dirty-form aggregation"
```

---

## Task 4: Pure helper — `handleStaleIdFallback`

**Context:** Side-effecting helper that toasts + navigates on stale-id discovery. Injects `pushToast` and `navigate` so it's vitest-testable. `pushToast` is a function (not an object with `info` / `success` / `error` methods); the helper calls it as `pushToast(msg, 'info')` to match slice-1 toast wording for benign navigations.

**Files:**
- Create: `frontend/src/lib/handleStaleIdFallback.ts`
- Create: `frontend/src/tests/handleStaleIdFallback.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `frontend/src/tests/handleStaleIdFallback.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleStaleIdFallback } from '../lib/handleStaleIdFallback';

function setup() {
  const pushToast = vi.fn();
  const navigate = vi.fn();
  return { pushToast, navigate };
}

describe('handleStaleIdFallback', () => {
  it('staleBid=true: toast "Block not found." (info) + navigate to /edit/v/{vid} with replace+force', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: true, staleSid: false },
      { courseSlug: 'cs101', vid: '10', bid: null },
      { pushToast, navigate },
    );
    expect(pushToast).toHaveBeenCalledWith('Block not found.', 'info');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10', { replace: true, force: true });
  });

  it('staleSid=true (block intact): toast "Sequence not found." + navigate to block URL', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: false, staleSid: true },
      { courseSlug: 'cs101', vid: '10', bid: '100' },
      { pushToast, navigate },
    );
    expect(pushToast).toHaveBeenCalledWith('Sequence not found.', 'info');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10/blocks/100', { replace: true, force: true });
  });

  it('staleBid=true AND staleSid=true: staleBid wins — toast block, navigate to version', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: true, staleSid: true },
      { courseSlug: 'cs101', vid: '10', bid: null },
      { pushToast, navigate },
    );
    expect(pushToast).toHaveBeenCalledWith('Block not found.', 'info');
    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10', { replace: true, force: true });
  });

  it('both false: no-op (no toast, no navigate)', () => {
    const { pushToast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: false, staleSid: false },
      { courseSlug: 'cs101', vid: '10', bid: '100' },
      { pushToast, navigate },
    );
    expect(pushToast).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- handleStaleIdFallback
```

Expected: FAIL with "Failed to resolve import '../lib/handleStaleIdFallback'".

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/lib/handleStaleIdFallback.ts`:

```typescript
// Resolves a stale-id condition discovered by the validation $effect:
// toasts the user-facing message ('info' kind — this is a benign
// redirection, not an error) and navigates (replace + force) to the
// nearest valid parent URL. staleBid wins over staleSid because a missing
// block makes any nested sequence URL moot (cascade-deleted or
// unreachable). `force: true` bypasses DirtyGuard — prompting "save your
// changes?" on a deleted entity is pointless; Cancel would re-trigger the
// stale-id loop.
//
// Dependencies are injected (pushToast, navigate) so this stays pure-ish
// and vitest-testable without DOM.

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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- handleStaleIdFallback
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/lib/handleStaleIdFallback.ts frontend/src/tests/handleStaleIdFallback.test.ts
git commit -m "feat(frontend): add handleStaleIdFallback helper for stale-id recovery"
```

---

## Task 5: DirtyGuard copy update

**Files:**
- Modify: `frontend/src/components/editor/DirtyGuard.svelte`

- [ ] **Step 1: Read DirtyGuard to locate the prompt literal**

```bash
grep -n 'Discard unsaved' /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/components/editor/DirtyGuard.svelte
```

Expected: one line matching `'Discard unsaved changes?'`.

- [ ] **Step 2: Update the literal**

Edit `frontend/src/components/editor/DirtyGuard.svelte`: change the string `'Discard unsaved changes?'` to `'Discard unsaved changes and continue?'`. Single literal change.

- [ ] **Step 3: Run type-check + tests to verify nothing breaks**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check && npm test
```

Expected: No type errors. All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/DirtyGuard.svelte
git commit -m "fix(frontend): clarify DirtyGuard prompt — 'and continue?' makes OK behavior unambiguous"
```

---

## Task 6: `VersionMetaForm.svelte` — extracted version meta editor

**Context:** Extract the version-meta section from slice-1 `VersionEditPage.svelte` into its own component. Owns its own `makeDirtyTracker`, registers it via `getContext(DIRTY_REGISTRY_KEY)`. The 3-way LoadResult save path and the 1–10 integer validation from slice-1 are preserved verbatim.

**Files:**
- Create: `frontend/src/components/editor/VersionMetaForm.svelte`

- [ ] **Step 1: Write VersionMetaForm.svelte**

Create `frontend/src/components/editor/VersionMetaForm.svelte`:

```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
  };

  let { vid, version }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — VersionEditPage must wrap VersionMetaForm');

  const perms = $derived(versionPermissions(version));

  type Meta = { info_md: string; max_quiz_attempts: number };
  const tracker = makeDirtyTracker<Meta>({
    info_md: version.info_md,
    max_quiz_attempts: version.max_quiz_attempts,
  });

  // Defensive rebuild on vid change. Slice-2 mount model destroys this
  // component when VersionEditPage unmounts (different course/version), so
  // this is belt-and-suspenders — see spec §Race safety carry-over.
  let trackerVid = $state(vid);
  $effect(() => {
    if (vid !== trackerVid) {
      tracker.reset({ info_md: version.info_md, max_quiz_attempts: version.max_quiz_attempts });
      trackerVid = vid;
    }
  });

  $effect(() => {
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  let busy = $state(false);

  async function save() {
    if (!tracker.isDirty) return;
    // Slice-1 client-side validation (Task-18 lesson preserved): bind:value
    // on <input type=number> can yield null/NaN/decimal — all 422 server-
    // side with an opaque message. Validate first.
    const n = tracker.current.max_quiz_attempts as number | null;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 10) {
      pushToast('Max quiz attempts must be a whole number between 1 and 10', 'error');
      return;
    }
    const savedVid = vid;
    const sentInfoMd = tracker.current.info_md;
    const sentAttempts = n;
    busy = true;
    try {
      await api.patch(`/api/versions/${savedVid}`, { info_md: sentInfoMd, max_quiz_attempts: sentAttempts });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value;
        if (fresh && fresh.version.id === savedVid) {
          tracker.reset({ info_md: fresh.version.info_md, max_quiz_attempts: fresh.version.max_quiz_attempts });
        }
        pushToast('Saved', 'success');
      } else {
        tracker.reset({ info_md: sentInfoMd, max_quiz_attempts: sentAttempts });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ info_md: version.info_md, max_quiz_attempts: version.max_quiz_attempts });
  }
</script>

{#if perms.canEditVersionMeta}
  <section class="meta">
    <h2>Version info</h2>
    <label>Info (markdown)
      <textarea bind:value={tracker.current.info_md} rows="4"></textarea>
    </label>
    <label>Max quiz attempts
      <input type="number" min="1" max="10" step="1" required bind:value={tracker.current.max_quiz_attempts} />
    </label>
    <div class="row">
      <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
      <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
    </div>
  </section>
{/if}

<style>
  .meta { margin: var(--space-4) 0; }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta textarea, .meta input[type=number] { width: 100%; }
  .row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; flex-wrap: wrap; }
</style>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/VersionMetaForm.svelte
git commit -m "feat(frontend): extract VersionMetaForm with context-based dirty registry"
```

---

## Task 7: `VersionEditPage` shell + dirty-registry provider

**Context:** Rewrite VersionEditPage as the new shell. Preserves slice-1 header structure (back-link + course name + state badge + disabled banner + state-actions bar), wires `createDirtyRegistry()` and provides it via `setContext(DIRTY_REGISTRY_KEY, ...)` *before* any consumer mounts. Accordion list, create-block form, validation `$effect`, and focus `$effect` land in Task 12 — this task lands shell + state-actions + VersionMetaForm.

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (full rewrite)

- [ ] **Step 1: Rewrite VersionEditPage shell**

Overwrite `frontend/src/pages/editor/VersionEditPage.svelte` with:

```svelte
<script lang="ts">
  import { setContext, onDestroy } from 'svelte';
  import { api, ApiError } from '../../lib/api';
  import { navigate } from '../../lib/router.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import VersionMetaForm from '../../components/editor/VersionMetaForm.svelte';
  import Button from '../../components/ui/Button.svelte';
  import Spinner from '../../components/ui/Spinner.svelte';
  import { pushToast } from '../../stores/toasts.svelte';

  type Props = {
    courseSlug: string;
    versionId: string;
    blockId?: string;
    sequenceId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId }: Props = $props();

  const vid = $derived(Number(versionId));
  const vidValid = $derived(Number.isInteger(vid) && vid > 0);
  const routeBid = $derived(blockId ?? null);
  const routeSid = $derived(sequenceId ?? null);

  // Provide dirty registry BEFORE any consumer mounts (provider-before-
  // consumers ordering per spec).
  const dirtyRegistry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);

  const tree = $derived(currentEditorVersion.value);
  const loadError = $derived(currentEditorVersion.error);
  const v = $derived(tree?.version);
  const slugMatches = $derived(!!tree && tree.course.slug === courseSlug);
  const perms = $derived(v ? versionPermissions(v) : null);

  let busy = $state(false);

  // Load $effect — declared FIRST (declaration-order discipline:
  // load → validation → focus, see spec §"$effect declaration order").
  // Validation + focus $effects land in Task 12.
  $effect(() => {
    if (!vidValid) return;
    void loadAdminTree(vid);
  });

  onDestroy(() => clearEditorVersion());

  async function transition(action: 'publish' | 'archive' | 'revert' | 'disable' | 'enable') {
    if (dirtyRegistry.isAnyDirty()) return;
    const prompts: Record<string, string> = {
      publish: `Publish version ${vid}? Students will see it.`,
      archive: `Archive version ${vid}?`,
      revert: `Revert version ${vid} to created?`,
      disable: `Disable version ${vid}?`,
      enable: `Enable version ${vid}?`,
    };
    if (!confirm(prompts[action])) return;
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/${action}`);
      await loadAdminTree(savedVid, { force: true });
      const past: Record<typeof action, string> = {
        publish: 'published', archive: 'archived', revert: 'reverted',
        disable: 'disabled', enable: 'enabled',
      };
      pushToast(`Version ${past[action]}`, 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : `Could not ${action}`, 'error');
    } finally {
      busy = false;
    }
  }

  async function deleteVersion() {
    if (dirtyRegistry.isAnyDirty()) return;
    if (!confirm(`Delete version ${vid}? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/versions/${savedVid}`);
      navigate(`/courses/${savedSlug}/edit`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="page">
  {#if !vidValid}
    <h1>Bad URL</h1>
    <p>Version "{versionId}" is not a valid id.</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if loadError && (!tree || tree.version.id !== vid)}
    <h1>Couldn't load</h1>
    <p>{loadError}</p>
    <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
  {:else if !tree || tree.version.id !== vid}
    <Spinner />
  {:else if !slugMatches}
    <h1>Not found</h1>
    <p>This version does not belong to course "{courseSlug}".</p>
    <Button onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Back</Button>
  {:else if !v || !perms}
    <Spinner />
  {:else}
    {#if loadError}
      <p class="banner err">{loadError}</p>
    {/if}
    <header>
      <Button variant="ghost" onclick={() => navigate(`/courses/${courseSlug}/edit`)}>← Versions</Button>
      <h1>{tree.course.name} · v{v.id} <span class="state state-{v.state}">{v.state}</span>{#if v.is_disabled}<span class="state disabled">disabled</span>{/if}</h1>
    </header>

    {#if v.is_disabled}
      <p class="banner">This version is disabled — editing is not allowed. Enable it first.</p>
    {/if}

    <VersionMetaForm {vid} {version}={v} />

    <!-- Blocks accordion list lands in Task 12. -->

    <section class="state-actions">
      {#if perms.canPublish}
        <Button disabled={busy} onclick={() => transition('publish')}>Publish</Button>
      {/if}
      {#if perms.canArchive}
        <Button disabled={busy} onclick={() => transition('archive')}>Archive</Button>
      {/if}
      {#if perms.canRevert}
        <Button disabled={busy} onclick={() => transition('revert')}>Revert</Button>
      {/if}
      {#if perms.canDisable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('disable')}>Disable</Button>
      {/if}
      {#if perms.canEnable}
        <Button variant="ghost" disabled={busy} onclick={() => transition('enable')}>Enable</Button>
      {/if}
      {#if perms.canDeleteVersion}
        <Button variant="ghost" disabled={busy} onclick={deleteVersion}>Delete</Button>
      {/if}
    </section>

    <DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} />
  {/if}
</div>

<style>
  .page { max-width: 960px; margin: 0 auto; padding: var(--space-3); }
  header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
  .state { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; margin-left: var(--space-2); }
  .state-created { background: #ffeac0; color: #663; }
  .state-published { background: #ddf3dd; color: #265; }
  .state-archived { background: #eee; color: #555; }
  .state.disabled { background: #fdd; color: #833; }
  .banner { background: #fff3cd; border-left: 3px solid #d99; padding: var(--space-2); }
  .banner.err { background: #fdd; border-left-color: #a33; color: #833; }
  .state-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; padding-top: var(--space-3); border-top: 1px solid var(--border); }
</style>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors. (Existing routes still point to BlockEditPage / SequenceEditPage until Task 13; both pages still exist until Task 14.)

- [ ] **Step 3: Verify shell renders without console errors**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run dev
```

In browser: login → open an admin course → click a version → page should render the header (back-link + `Course · v{vid}` + state badge), the version-meta form below, and the state-actions bar at the bottom. No blocks accordion yet (that's Task 12). No console errors. The `← Versions` link works and returns to the versions list.

Stop the dev server (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/pages/editor/VersionEditPage.svelte
git commit -m "feat(frontend): rewrite VersionEditPage shell with dirty-registry provider"
```

---

## Task 8: `AccordionHeader.svelte` — pure presentational header

**Files:**
- Create: `frontend/src/components/editor/AccordionHeader.svelte`

- [ ] **Step 1: Write AccordionHeader**

Create `frontend/src/components/editor/AccordionHeader.svelte`:

```svelte
<script lang="ts">
  import { labelFor } from '../../lib/labelFor';

  type Props = {
    headerId: string;
    panelId: string;
    level: 'block' | 'sequence';
    title: string | null;
    slug: string | null;
    index: number;
    expanded: boolean;
    dirty: boolean;
    busy: boolean;
    canReorderUp: boolean;
    canReorderDown: boolean;
    onToggle: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };

  let {
    headerId,
    panelId,
    level,
    title,
    slug,
    index,
    expanded,
    dirty,
    busy,
    canReorderUp,
    canReorderDown,
    onToggle,
    onMoveUp,
    onMoveDown,
  }: Props = $props();

  const ariaName = $derived(labelFor(title, slug, `${level} ${index}`));
</script>

<div class="accordion-row">
  <button
    id={headerId}
    aria-expanded={expanded}
    aria-controls={panelId}
    aria-label={ariaName}
    onclick={onToggle}
    class="toggle"
  >
    <span class="title">{title?.trim() || slug?.trim() || `(${level} ${index})`}</span>
    {#if title?.trim() && slug?.trim()}
      <span class="slug" aria-hidden="true">/{slug}</span>
    {/if}
  </button>
  <button
    aria-label={`Move ${level} up: ${ariaName}`}
    onclick={onMoveUp}
    disabled={!canReorderUp || dirty || busy}
    title={dirty ? 'Save or discard changes first' : ''}
  >↑</button>
  <button
    aria-label={`Move ${level} down: ${ariaName}`}
    onclick={onMoveDown}
    disabled={!canReorderDown || dirty || busy}
    title={dirty ? 'Save or discard changes first' : ''}
  >↓</button>
</div>

<style>
  .accordion-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2); border-bottom: 1px solid var(--border); }
  .toggle { flex: 1; display: flex; align-items: center; gap: var(--space-2); background: transparent; border: 0; cursor: pointer; text-align: left; font-size: 1rem; padding: var(--space-1) var(--space-2); }
  .toggle:hover { background: var(--surface-hover, #f5f5f5); }
  .title { font-weight: 600; }
  .slug { color: var(--muted); font-size: 0.85rem; }
</style>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/AccordionHeader.svelte
git commit -m "feat(frontend): add AccordionHeader pure-presentational header component"
```

---

## Task 9: `ItemRow.svelte` — one item in a sequence's list

**Context:** Pure presentational + callbacks. Reorder, delete, and open are emitted up to SequenceAccordion (which owns the items list and the API calls). Visible title follows the same fallback chain and slug-span suppression rule as AccordionHeader.

**Files:**
- Create: `frontend/src/components/editor/ItemRow.svelte`

- [ ] **Step 1: Write ItemRow**

Create `frontend/src/components/editor/ItemRow.svelte`:

```svelte
<script lang="ts">
  import { labelFor } from '../../lib/labelFor';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeItem } from '../../lib/types';

  type Props = {
    item: AdminTreeItem;
    index: number;
    canStructure: boolean;
    canReorderUp: boolean;
    canReorderDown: boolean;
    parentDirty: boolean;
    busy: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onOpen: () => void;
    onDelete: () => void;
  };

  let {
    item,
    index,
    canStructure,
    canReorderUp,
    canReorderDown,
    parentDirty,
    busy,
    onMoveUp,
    onMoveDown,
    onOpen,
    onDelete,
  }: Props = $props();

  const ariaName = $derived(labelFor(item.title, item.slug, `item ${index}`));

  const glyph = $derived(
    item.type === 'static_page' ? '📄' :
    item.type === 'video' ? '▶' :
    item.type === 'quiz' ? '?' :
    '⌘'
  );
</script>

<div class="item-row">
  <span class="glyph" aria-hidden="true">{glyph}</span>
  <span class="item-title">
    {item.title?.trim() || item.slug?.trim() || `(item ${index})`}
  </span>
  {#if item.title?.trim() && item.slug?.trim()}
    <span class="item-slug" aria-hidden="true">/{item.slug}</span>
  {/if}
  <div class="actions">
    {#if canStructure}
      <Button
        variant="ghost"
        aria-label={`Move item up: ${ariaName}`}
        onclick={onMoveUp}
        disabled={!canReorderUp || parentDirty || busy}
        title={parentDirty ? 'Save or discard changes first' : 'Move up'}
      >↑</Button>
      <Button
        variant="ghost"
        aria-label={`Move item down: ${ariaName}`}
        onclick={onMoveDown}
        disabled={!canReorderDown || parentDirty || busy}
        title={parentDirty ? 'Save or discard changes first' : 'Move down'}
      >↓</Button>
    {/if}
    <Button
      aria-label={`Open ${ariaName}`}
      onclick={onOpen}
      disabled={busy}
    >Open</Button>
    {#if canStructure}
      <Button
        variant="ghost"
        aria-label={`Delete ${ariaName}`}
        onclick={onDelete}
        disabled={busy}
      >Delete</Button>
    {/if}
  </div>
</div>

<style>
  .item-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .glyph { width: 24px; text-align: center; opacity: 0.65; }
  .item-title { font-weight: 600; flex: 1; }
  .item-slug { color: var(--muted); font-size: 0.85rem; }
  .actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
</style>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/ItemRow.svelte
git commit -m "feat(frontend): add ItemRow component with callback-based actions"
```

---

## Task 10: `SequenceAccordion.svelte` — one sequence (owns item list)

**Context:** Owns the sequence-meta form (registers tracker via context), the items list (renders ItemRow per item), the item-reorder + item-delete API calls, and the create-item form (with ItemTypePicker + per-type required fields). Receives `onMoveUp` / `onMoveDown` callbacks from BlockAccordion for its OWN reorder buttons (sequence-list reorder lives in BlockAccordion).

**Files:**
- Create: `frontend/src/components/editor/SequenceAccordion.svelte`

- [ ] **Step 1: Write SequenceAccordion**

Create `frontend/src/components/editor/SequenceAccordion.svelte`:

```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import ItemRow from './ItemRow.svelte';
  import ItemTypePicker from './ItemTypePicker.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeBlock, AdminTreeSequence } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    seq: AdminTreeSequence;
    index: number;
    sequenceCount: number;
    routeBid: string | null;
    routeSid: string | null;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };

  let {
    courseSlug,
    vid,
    block,
    seq,
    index,
    sequenceCount,
    routeBid,
    routeSid,
    onMoveUp,
    onMoveDown,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — SequenceAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid && String(seq.id) === routeSid);
  const headerId = `seq-${String(seq.id)}-header`;
  const panelId = `seq-${String(seq.id)}-panel`;

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canEdit = $derived(perms?.canEditTextFields ?? false);
  const canStructure = $derived(perms?.canEditStructure ?? false);

  type Meta = { title: string };
  const tracker = makeDirtyTracker<Meta>({ title: seq.title });

  // Defensive rebuild on seq.id change (belt-and-suspenders — child body
  // unmounts via {#if expanded} so a sid change typically remounts the
  // whole component).
  let trackerSid = $state(seq.id);
  $effect(() => {
    if (seq.id !== trackerSid) {
      tracker.reset({ title: seq.title });
      trackerSid = seq.id;
    }
  });

  $effect(() => {
    if (!expanded) return;
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}`);
    }
  }

  let busy = $state(false);

  async function save() {
    if (!tracker.isDirty) return;
    const savedVid = vid;
    const savedSid = seq.id;
    const savedBid = block.id;
    const sentTitle = tracker.current.title;
    busy = true;
    try {
      await api.patch(`/api/sequences/${savedSid}`, { title: sentTitle });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value?.blocks.find((b) => b.id === savedBid)?.sequences.find((x) => x.id === savedSid);
        if (fresh) tracker.reset({ title: fresh.title });
        pushToast('Saved', 'success');
      } else {
        tracker.reset({ title: sentTitle });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ title: seq.title });
  }

  async function deleteSeq() {
    if (tracker.isDirty || !canStructure || seq.items.length > 0) return;
    if (!confirm(`Delete sequence "${seq.title}"? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/sequences/${savedSid}`);
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Item-list reorder: this component owns seq.items and the API call.
  async function reorderItem(idx: number, dir: -1 | 1) {
    if (tracker.isDirty) return;
    const items = [...seq.items];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    const order = items.map((it, i) => ({ id: it.id, order: i + 1 }));
    const savedVid = vid;
    const savedSid = seq.id;
    busy = true;
    try {
      await api.post(`/api/sequences/${savedSid}/items/reorder`, { order });
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  async function deleteItem(itemId: number, itemTitle: string) {
    if (busy || !canStructure) return;
    if (!confirm(`Delete "${itemTitle}"? This cannot be undone.`)) return;
    const savedVid = vid;
    busy = true;
    try {
      await api.delete(`/api/items/${itemId}`);
      await loadAdminTree(savedVid, { force: true });
      pushToast('Item deleted', 'success');
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  function openItem(itemId: number) {
    void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}/items/${itemId}`);
  }

  // Inline create-item form
  let creating = $state(false);
  let newType = $state<'static_page' | 'video'>('static_page');
  let newTitle = $state('');
  let newSlug = $state('');
  let newContentMd = $state('');
  let newVideoUrl = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);
  let contentMdTouched = $state(false);

  $effect(() => {
    if (creating && newType === 'static_page' && !contentMdTouched && newTitle) {
      newContentMd = `# ${newTitle}\n`;
    }
  });

  // Tracker shim for the create form: synthesized isDirty getter reads
  // current state directly — NO reset()-on-keystroke (that would always
  // make the tracker clean and break smoke 14b).
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (
        newTitle.trim() !== '' ||
        newSlug.trim() !== '' ||
        (newType === 'static_page' && newContentMd.trim() !== '' && newContentMd !== `# ${newTitle}\n`) ||
        (newType === 'video' && newVideoUrl.trim() !== '')
      );
    },
  };

  $effect(() => {
    if (!creating) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  function resetCreateForm() {
    newType = 'static_page';
    newTitle = '';
    newSlug = '';
    newContentMd = '';
    newVideoUrl = '';
    contentMdTouched = false;
    createErrors = {};
    createGlobalError = null;
  }

  function toggleCreate() {
    if (creating) resetCreateForm();
    creating = !creating;
  }

  async function submitCreate() {
    if (createBusy || !newTitle.trim() || !newSlug.trim()) return;
    const savedVid = vid;
    const savedBid = block.id;
    const savedSid = seq.id;
    const savedSlug = courseSlug;
    const body: Record<string, unknown> = { title: newTitle, slug: newSlug, type: newType };
    if (newType === 'static_page') body.content_md = newContentMd;
    if (newType === 'video') body.video_url = newVideoUrl;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      const item = await api.post<{ id: number }>(`/api/sequences/${savedSid}/items`, body);
      await loadAdminTree(savedVid, { force: true });
      resetCreateForm();
      creating = false;
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}/blocks/${savedBid}/sequences/${savedSid}/items/${item.id}`);
    } catch (e) {
      const known = newType === 'static_page'
        ? ['title', 'slug', 'content_md', 'type']
        : ['title', 'slug', 'video_url', 'type'];
      const mapped = mapCreateError(e, known);
      createErrors = mapped.fieldErrors;
      createGlobalError = mapped.globalMessage;
      if (mapped.globalMessage && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(mapped.globalMessage, 'error');
      }
    } finally {
      createBusy = false;
    }
  }
</script>

<div class="sequence">
  <AccordionHeader
    {headerId}
    {panelId}
    level="sequence"
    title={seq.title}
    slug={seq.slug}
    {index}
    {expanded}
    dirty={tracker.isDirty}
    {busy}
    canReorderUp={canStructure && index > 1}
    canReorderDown={canStructure && index < sequenceCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
      {#if canEdit}
        <section class="meta">
          <label>Sequence title <input bind:value={tracker.current.title} required /></label>
          <div class="row">
            <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
            <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
          </div>
        </section>
      {/if}

      <section class="items">
        <div class="head">
          <h4>Items</h4>
          {#if canStructure}
            <Button
              disabled={tracker.isDirty || busy}
              title={tracker.isDirty ? 'Save or discard changes first' : ''}
              onclick={toggleCreate}
            >{creating ? 'Cancel' : '+ New item'}</Button>
          {/if}
        </div>

        {#if creating}
          <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <ItemTypePicker bind:value={newType} />
            <div class="field">
              <input placeholder="Title" bind:value={newTitle} required oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
              {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
            </div>
            <div class="field">
              <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" oninput={() => { if (createErrors.slug) createErrors = { ...createErrors, slug: '' }; }} />
              {#if createErrors.slug}<small class="field-err">{createErrors.slug}</small>{/if}
            </div>
            {#if newType === 'static_page'}
              <div class="field">
                <textarea placeholder="Content (markdown)" rows="4" bind:value={newContentMd} oninput={() => { contentMdTouched = true; if (createErrors.content_md) createErrors = { ...createErrors, content_md: '' }; }} required></textarea>
                {#if createErrors.content_md}<small class="field-err">{createErrors.content_md}</small>{/if}
              </div>
            {:else if newType === 'video'}
              <div class="field">
                <input type="url" placeholder="Video URL (https://…)" bind:value={newVideoUrl} required oninput={() => { if (createErrors.video_url) createErrors = { ...createErrors, video_url: '' }; }} />
                {#if createErrors.video_url}<small class="field-err">{createErrors.video_url}</small>{/if}
              </div>
            {/if}
            {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
            <Button type="submit" disabled={tracker.isDirty || createBusy || !newTitle.trim() || !newSlug.trim()} loading={createBusy}>Create</Button>
          </form>
        {/if}

        {#if seq.items.length === 0}
          <p class="empty">
            {canStructure ? 'No items yet — pick a type above to add one.' : 'No items.'}
          </p>
        {:else}
          <ul class="items-list">
            {#each seq.items as item, i (item.id)}
              <li>
                <ItemRow
                  {item}
                  index={i + 1}
                  {canStructure}
                  canReorderUp={canStructure && i > 0}
                  canReorderDown={canStructure && i < seq.items.length - 1}
                  parentDirty={tracker.isDirty}
                  {busy}
                  onMoveUp={() => void reorderItem(i, -1)}
                  onMoveDown={() => void reorderItem(i, 1)}
                  onOpen={() => openItem(item.id)}
                  onDelete={() => void deleteItem(item.id, item.title)}
                />
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if canStructure}
        <section class="danger">
          <Button
            variant="ghost"
            disabled={tracker.isDirty || busy || seq.items.length > 0}
            title={tracker.isDirty ? 'Save or discard changes first' : seq.items.length > 0 ? 'Remove items first' : ''}
            onclick={deleteSeq}
          >Delete this sequence</Button>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sequence { border: 1px solid var(--border); border-radius: var(--radius); margin: var(--space-2) 0; }
  .accordion-body { padding: var(--space-3); border-top: 1px solid var(--border); }
  .meta { margin-bottom: var(--space-3); }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input { width: 100%; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: grid; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input, .create textarea { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .items-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); margin-top: var(--space-3); }
</style>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/SequenceAccordion.svelte
git commit -m "feat(frontend): add SequenceAccordion (owns item list + create-item form)"
```

---

## Task 11: `BlockAccordion.svelte` — one block (owns sequence list)

**Context:** Owns the block-meta form, the sequence list (renders SequenceAccordion per sequence), the sequence-reorder + sequence-delete API calls (delete is delegated through SequenceAccordion's body button — only sequence-list reorder lives here), and the create-sequence form. Block uses `info` field (NOT `info_md`). Receives `onMoveUp` / `onMoveDown` callbacks from VersionEditPage for its OWN reorder buttons.

**Files:**
- Create: `frontend/src/components/editor/BlockAccordion.svelte`

- [ ] **Step 1: Write BlockAccordion**

Create `frontend/src/components/editor/BlockAccordion.svelte`:

```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry, type RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import { versionPermissions } from '../../lib/versionPermissions';
  import { navigate } from '../../lib/router.svelte';
  import { api, ApiError } from '../../lib/api';
  import { pushToast } from '../../stores/toasts.svelte';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import Button from '../ui/Button.svelte';
  import type { AdminTreeBlock } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    index: number;
    blockCount: number;
    routeBid: string | null;
    routeSid: string | null;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };

  let {
    courseSlug,
    vid,
    block,
    index,
    blockCount,
    routeBid,
    routeSid,
    onMoveUp,
    onMoveDown,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — BlockAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid);
  const headerId = `block-${String(block.id)}-header`;
  const panelId = `block-${String(block.id)}-panel`;

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const perms = $derived(version ? versionPermissions(version) : null);
  const canEdit = $derived(perms?.canEditTextFields ?? false);
  const canStructure = $derived(perms?.canEditStructure ?? false);

  type Meta = { title: string; info: string };
  const tracker = makeDirtyTracker<Meta>({ title: block.title, info: block.info });

  let trackerBid = $state(block.id);
  $effect(() => {
    if (block.id !== trackerBid) {
      tracker.reset({ title: block.title, info: block.info });
      trackerBid = block.id;
    }
  });

  $effect(() => {
    if (!expanded) return;
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  function toggle() {
    if (expanded) {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}`);
    } else {
      void navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    }
  }

  let busy = $state(false);

  async function save() {
    if (!tracker.isDirty) return;
    const savedVid = vid;
    const savedBid = block.id;
    const sentTitle = tracker.current.title;
    const sentInfo = tracker.current.info;
    busy = true;
    try {
      await api.patch(`/api/blocks/${savedBid}`, { title: sentTitle, info: sentInfo });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'discarded') {
        pushToast('Saved', 'success');
      } else if (result === 'ok') {
        const fresh = currentEditorVersion.value?.blocks.find((b) => b.id === savedBid);
        if (fresh) tracker.reset({ title: fresh.title, info: fresh.info });
        pushToast('Saved', 'success');
      } else {
        tracker.reset({ title: sentTitle, info: sentInfo });
        pushToast('Saved (refresh failed — reload to see latest)', 'info');
      }
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Save failed', 'error');
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ title: block.title, info: block.info });
  }

  async function deleteBlock() {
    if (tracker.isDirty || !canStructure || block.sequences.length > 0) return;
    if (!confirm(`Delete block "${block.title}"? This cannot be undone.`)) return;
    const savedVid = vid;
    const savedSlug = courseSlug;
    busy = true;
    try {
      await api.delete(`/api/blocks/${block.id}`);
      void navigate(`/courses/${savedSlug}/edit/v/${savedVid}`);
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Delete failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Sequence-list reorder: this component owns block.sequences and the API call.
  async function reorderSeq(idx: number, dir: -1 | 1) {
    if (tracker.isDirty) return;
    const seqs = [...block.sequences];
    const target = idx + dir;
    if (target < 0 || target >= seqs.length) return;
    [seqs[idx], seqs[target]] = [seqs[target], seqs[idx]];
    const order = seqs.map((s, i) => ({ id: s.id, order: i + 1 }));
    const savedVid = vid;
    const savedBid = block.id;
    busy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences/reorder`, { order });
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }

  // Inline create-sequence form
  let creating = $state(false);
  let newTitle = $state('');
  let newSlug = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (newTitle.trim() !== '' || newSlug.trim() !== '');
    },
  };

  $effect(() => {
    if (!creating) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  function toggleCreate() {
    if (creating) { newTitle = ''; newSlug = ''; createErrors = {}; createGlobalError = null; }
    creating = !creating;
  }

  async function submitCreate() {
    if (createBusy || !newTitle.trim() || !newSlug.trim()) return;
    const savedVid = vid;
    const savedBid = block.id;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/blocks/${savedBid}/sequences`, { title: newTitle, slug: newSlug });
      newTitle = ''; newSlug = ''; creating = false;
      await loadAdminTree(savedVid, { force: true });
      pushToast('Sequence created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title', 'slug']);
      createErrors = mapped.fieldErrors;
      createGlobalError = mapped.globalMessage;
      if (mapped.globalMessage && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(mapped.globalMessage, 'error');
      }
    } finally {
      createBusy = false;
    }
  }
</script>

<div class="block">
  <AccordionHeader
    {headerId}
    {panelId}
    level="block"
    title={block.title}
    slug={block.slug}
    {index}
    {expanded}
    dirty={tracker.isDirty}
    {busy}
    canReorderUp={canStructure && index > 1}
    canReorderDown={canStructure && index < blockCount}
    onToggle={toggle}
    {onMoveUp}
    {onMoveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
      {#if canEdit}
        <section class="meta">
          <label>Title <input bind:value={tracker.current.title} required /></label>
          <label>Info (markdown) <textarea bind:value={tracker.current.info} rows="3"></textarea></label>
          <div class="row">
            <Button onclick={save} disabled={!tracker.isDirty || busy} loading={busy}>Save</Button>
            <Button variant="ghost" onclick={discard} disabled={!tracker.isDirty || busy}>Discard</Button>
          </div>
        </section>
      {/if}

      <section class="seqs">
        <div class="head">
          <h3>Sequences</h3>
          {#if canStructure}
            <Button
              disabled={tracker.isDirty || busy}
              title={tracker.isDirty ? 'Save or discard changes first' : ''}
              onclick={toggleCreate}
            >{creating ? 'Cancel' : '+ New sequence'}</Button>
          {/if}
        </div>

        {#if creating}
          <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <div class="field">
              <input placeholder="Title" bind:value={newTitle} required oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
              {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
            </div>
            <div class="field">
              <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" oninput={() => { if (createErrors.slug) createErrors = { ...createErrors, slug: '' }; }} />
              {#if createErrors.slug}<small class="field-err">{createErrors.slug}</small>{/if}
            </div>
            {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
            <Button type="submit" disabled={tracker.isDirty || createBusy || !newTitle.trim() || !newSlug.trim()} loading={createBusy}>Create</Button>
          </form>
        {/if}

        {#if block.sequences.length === 0}
          <p class="empty">
            {canStructure ? 'No sequences yet.' : 'No sequences.'}
          </p>
        {:else}
          <ul class="seqs-list">
            {#each block.sequences as seq, i (seq.id)}
              <li>
                <SequenceAccordion
                  {courseSlug}
                  {vid}
                  {block}
                  {seq}
                  index={i + 1}
                  sequenceCount={block.sequences.length}
                  {routeBid}
                  {routeSid}
                  onMoveUp={() => void reorderSeq(i, -1)}
                  onMoveDown={() => void reorderSeq(i, 1)}
                />
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if canStructure}
        <section class="danger">
          <Button
            variant="ghost"
            disabled={tracker.isDirty || busy || block.sequences.length > 0}
            title={tracker.isDirty ? 'Save or discard changes first' : block.sequences.length > 0 ? 'Remove sequences first' : ''}
            onclick={deleteBlock}
          >Delete this block</Button>
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .block { border: 1px solid var(--border); border-radius: var(--radius); margin: var(--space-2) 0; }
  .accordion-body { padding: var(--space-3); border-top: 1px solid var(--border); }
  .meta { margin-bottom: var(--space-3); }
  .meta label { display: block; margin: var(--space-2) 0; }
  .meta input, .meta textarea { width: 100%; }
  .row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .seqs-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
  .danger { padding-top: var(--space-3); border-top: 1px solid var(--border); margin-top: var(--space-3); }
</style>
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/BlockAccordion.svelte
git commit -m "feat(frontend): add BlockAccordion (owns sequence list + reorder + create form)"
```

---

## Task 12: VersionEditPage accordion wiring + validation/focus effects + block reorder/create

**Context:** Fills in the shell from Task 7: adds the blocks accordion list (with VersionEditPage owning block-list reorder), the validation `$effect` (declared SECOND, after load), the focus `$effect` (declared THIRD), and the inline create-block form. Effect declaration order: **load → validation → focus**.

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte`

- [ ] **Step 1: Add imports + block-reorder + validation/focus effects + create-block + accordion list**

Apply the changes below to `frontend/src/pages/editor/VersionEditPage.svelte`. Read the current file first to confirm the section boundaries:

```bash
sed -n '1,200p' /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/VersionEditPage.svelte
```

Then make these edits inside `<script>`:

a) Add to imports:

```typescript
  import { tick } from 'svelte';
  import { deriveExpansion } from '../../lib/deriveExpansion';
  import { handleStaleIdFallback } from '../../lib/handleStaleIdFallback';
  import { mapCreateError, type FieldErrors } from '../../lib/formErrors';
  import BlockAccordion from '../../components/editor/BlockAccordion.svelte';
  import type { RegisteredTracker } from '../../lib/dirtyRegistry.svelte';
```

b) After the existing load `$effect`, insert the validation `$effect` (declared SECOND, before focus):

```typescript
  // Validation $effect — declared SECOND in declaration order so stale-id
  // correction lands before the focus effect tries to find a toggle for a
  // stale entity.
  $effect(() => {
    if (!tree) return;
    const expansion = deriveExpansion(routeBid, routeSid, tree);
    if (expansion.staleBid || expansion.staleSid) {
      handleStaleIdFallback(
        { staleBid: expansion.staleBid, staleSid: expansion.staleSid },
        { courseSlug, vid: String(vid), bid: routeBid },
        { pushToast, navigate },
      );
    }
  });
```

c) After the validation `$effect`, insert the focus `$effect` (declared THIRD):

```typescript
  // Focus $effect — declared THIRD. Tracks (routeBid, routeSid, tree) so it
  // re-fires after the initial admin-tree load resolves on deep-link mount.
  $effect(() => {
    const bid = routeBid;
    const sid = routeSid;
    const t = currentEditorVersion.value;
    if (!t) return;

    // Resolve deepest expanded headerId from current state.
    let headerId: string | null = null;
    if (bid !== null) {
      const blockMatch = t.blocks.find((b) => String(b.id) === bid);
      if (blockMatch) {
        if (sid !== null) {
          const seqMatch = blockMatch.sequences.find((s) => String(s.id) === sid);
          headerId = seqMatch
            ? `seq-${String(seqMatch.id)}-header`
            : `block-${String(blockMatch.id)}-header`;
        } else {
          headerId = `block-${String(blockMatch.id)}-header`;
        }
      }
    }
    if (!headerId) return;

    // Capture the target headerId before await so a later effect run can't
    // race ahead of this one.
    const targetHeaderId = headerId;
    let cancelled = false;
    void (async () => {
      await tick();
      if (cancelled) return;
      // Read activeElement BEFORE any focus() call — once we focus we have
      // changed activeElement ourselves and the discriminator becomes
      // self-referential.
      const active = document.activeElement?.id ?? null;
      if (active === targetHeaderId) return; // user-click branch
      const el = document.getElementById(targetHeaderId);
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
    })();
    return () => { cancelled = true; };
  });
```

d) Add block-list reorder handler (VersionEditPage owns this since it iterates `tree.blocks`):

```typescript
  async function reorderBlock(idx: number, dir: -1 | 1) {
    if (dirtyRegistry.isAnyDirty()) return;
    if (!tree) return;
    const blocks = [...tree.blocks];
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
    const order = blocks.map((b, i) => ({ id: b.id, order: i + 1 }));
    const savedVid = vid;
    busy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks/reorder`, { order });
      await loadAdminTree(savedVid, { force: true });
    } catch (e) {
      pushToast(e instanceof ApiError ? e.displayMessage : 'Reorder failed', 'error');
      await loadAdminTree(savedVid, { force: true });
    } finally {
      busy = false;
    }
  }
```

e) Add inline create-block form state + handlers + tracker shim:

```typescript
  let creating = $state(false);
  let newTitle = $state('');
  let newSlug = $state('');
  let createErrors = $state<FieldErrors>({});
  let createGlobalError = $state<string | null>(null);
  let createBusy = $state(false);

  // Tracker shim with synthesized isDirty — no reset()-on-keystroke.
  const createTracker: RegisteredTracker = {
    get isDirty() {
      return creating && (newTitle.trim() !== '' || newSlug.trim() !== '');
    },
  };

  $effect(() => {
    if (!creating) return;
    dirtyRegistry.register(createTracker);
    return () => dirtyRegistry.unregister(createTracker);
  });

  function toggleCreate() {
    if (creating) { newTitle = ''; newSlug = ''; createErrors = {}; createGlobalError = null; }
    creating = !creating;
  }

  async function submitCreateBlock() {
    if (createBusy || !newTitle.trim() || !newSlug.trim()) return;
    const savedVid = vid;
    createErrors = {};
    createGlobalError = null;
    createBusy = true;
    try {
      await api.post(`/api/versions/${savedVid}/blocks`, { title: newTitle, slug: newSlug, info: '' });
      newTitle = ''; newSlug = ''; creating = false;
      await loadAdminTree(savedVid, { force: true });
      pushToast('Block created', 'success');
    } catch (e) {
      const mapped = mapCreateError(e, ['title', 'slug']);
      createErrors = mapped.fieldErrors;
      createGlobalError = mapped.globalMessage;
      if (mapped.globalMessage && Object.keys(mapped.fieldErrors).length === 0) {
        pushToast(mapped.globalMessage, 'error');
      }
    } finally {
      createBusy = false;
    }
  }
```

f) Replace the `<!-- Blocks accordion list lands in Task 12. -->` placeholder with the blocks accordion section, placed after `<VersionMetaForm {vid} {version}={v} />` and before the `<section class="state-actions">`:

```svelte
    <section class="blocks">
      <div class="head">
        <h2>Blocks</h2>
        {#if perms.canEditStructure}
          <Button
            disabled={dirtyRegistry.isAnyDirty() || busy}
            title={dirtyRegistry.isAnyDirty() ? 'Save or discard changes first' : ''}
            onclick={toggleCreate}
          >{creating ? 'Cancel' : '+ New block'}</Button>
        {/if}
      </div>

      {#if creating}
        <form class="create" onsubmit={(e) => { e.preventDefault(); void submitCreateBlock(); }}>
          <div class="field">
            <input placeholder="Title" bind:value={newTitle} required oninput={() => { if (createErrors.title) createErrors = { ...createErrors, title: '' }; }} />
            {#if createErrors.title}<small class="field-err">{createErrors.title}</small>{/if}
          </div>
          <div class="field">
            <input placeholder="Slug" bind:value={newSlug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" oninput={() => { if (createErrors.slug) createErrors = { ...createErrors, slug: '' }; }} />
            {#if createErrors.slug}<small class="field-err">{createErrors.slug}</small>{/if}
          </div>
          {#if createGlobalError}<p class="form-err" role="alert">{createGlobalError}</p>{/if}
          <Button type="submit" disabled={createBusy || !newTitle.trim() || !newSlug.trim()} loading={createBusy}>Create</Button>
        </form>
      {/if}

      {#if tree.blocks.length === 0}
        <p class="empty">
          {perms.canEditStructure ? 'This version has no blocks yet.' : 'This version has no blocks.'}
        </p>
      {:else}
        <ul class="blocks-list">
          {#each tree.blocks as block, i (block.id)}
            <li>
              <BlockAccordion
                {courseSlug}
                {vid}
                {block}
                index={i + 1}
                blockCount={tree.blocks.length}
                {routeBid}
                {routeSid}
                onMoveUp={() => void reorderBlock(i, -1)}
                onMoveDown={() => void reorderBlock(i, 1)}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
```

g) Add to the `<style>` block:

```css
  .blocks { margin: var(--space-4) 0; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
  .create { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
  .create input { width: 100%; }
  .create .field { display: flex; flex-direction: column; }
  .field-err { color: var(--danger); font-size: 0.85rem; margin-top: var(--space-1); display: block; }
  .form-err { color: var(--danger); font-size: 0.9rem; margin: 0; }
  .blocks-list { list-style: none; padding: 0; margin: 0; }
  .empty { color: var(--muted); }
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/pages/editor/VersionEditPage.svelte
git commit -m "feat(frontend): wire VersionEditPage accordion + stale-id + focus + create-block"
```

---

## Task 13: Routes + componentMap rebinding

**Context:** Three routes (`/v/:vid`, `/blocks/:bid`, `/sequences/:sid`) all point to `VersionEditPage`. `App.svelte` removes the deleted-page imports + entries.

**Files:**
- Modify: `frontend/src/routes.ts`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Update `routes.ts`**

Edit `frontend/src/routes.ts`. Replace these three entries:

```typescript
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'BlockEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'SequenceEditPage', auth: true },
```

with:

```typescript
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'VersionEditPage', auth: true },
```

The `/courses/:courseSlug/edit/v/:versionId` and `.../items/:itemId` entries are unchanged.

- [ ] **Step 2: Update `App.svelte`**

In `frontend/src/App.svelte`:

a) Remove these imports:

```typescript
  import BlockEditPage from './pages/editor/BlockEditPage.svelte';
  import SequenceEditPage from './pages/editor/SequenceEditPage.svelte';
```

b) Remove these `componentMap` entries:

```typescript
    BlockEditPage: BlockEditPage as Component<Record<string, string>>,
    SequenceEditPage: SequenceEditPage as Component<Record<string, string>>,
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors. (The deleted-page files still exist on disk until Task 14, but no source code references them anymore.)

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/routes.ts frontend/src/App.svelte
git commit -m "refactor(frontend): rebind /blocks/:bid and /sequences/:sid to VersionEditPage"
```

---

## Task 14: Delete obsolete pages

**Files:**
- Delete: `frontend/src/pages/editor/BlockEditPage.svelte`
- Delete: `frontend/src/pages/editor/SequenceEditPage.svelte`

- [ ] **Step 1: Verify no remaining references**

```bash
grep -r "BlockEditPage\|SequenceEditPage" /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/ --include="*.ts" --include="*.svelte"
```

Expected: only matches inside the two page files themselves. Zero references in routes.ts, App.svelte, or any component.

- [ ] **Step 2: Delete the files**

```bash
rm /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/BlockEditPage.svelte
rm /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/SequenceEditPage.svelte
```

- [ ] **Step 3: Type-check + full test suite**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check && npm test
```

Expected: No type errors. All existing tests pass (plus the new ones from Tasks 1–4).

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add -u frontend/src/pages/editor/
git commit -m "refactor(frontend): delete BlockEditPage and SequenceEditPage — merged into accordion"
```

---

## Task 15: Manual smoke pass

**Context:** Execute every smoke item from the spec's checklist in the dev environment.

**Files:** none — verification only.

- [ ] **Step 1: Start backend + frontend**

In one terminal:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

In another:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run dev
```

- [ ] **Step 2: Seed demo data if needed**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/backend
.venv/bin/python scripts/seed_demo.py
```

- [ ] **Step 3: Execute each smoke item**

Open the spec at `docs/superpowers/specs/2026-05-10-editor-accordion-design.md` to the "Manual smoke checklist (slice 2)" section. Execute each numbered item in a real browser. For items 18 / 24 / 25 / 28 / 28b / 28c / 28d use VoiceOver (macOS) or another screen reader.

Items: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14b, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 26b, 27, 28, 28b, 28c, 28d.

- [ ] **Step 4: Record results**

For each item that fails: open the most relevant file from the file-map at the top of this plan, write a regression test FIRST in `frontend/src/tests/` (if testable as a pure helper), make the test fail to repro, fix the defect, re-run `npm test && npm run check`, then commit:

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add <file(s)>
git commit -m "fix(frontend): <defect description from smoke item N>"
```

If all items pass, this task is complete — no commit needed.

---

## Task 16: Final svelte-check + full vitest run

**Files:** none — verification only.

- [ ] **Step 1: Run svelte-check across the whole frontend**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: zero errors, zero warnings.

- [ ] **Step 2: Run the full vitest suite**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test
```

Expected: all tests pass (including the 4 new helper tests). Existing tests still green.

- [ ] **Step 3: Verify branch is ready to merge**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git log --oneline main..frontend-admin-editor-accordion | head -30
git status
```

Expected: clean working tree, commits visible from Task 1 through Task 15.

---

## Self-review

**Spec coverage:**
- §Goal / §Architecture overview → Tasks 7, 12 ✓
- §Components table → Tasks 6 (VersionMetaForm), 8 (AccordionHeader), 9 (ItemRow), 10 (SequenceAccordion), 11 (BlockAccordion), 7+12 (VersionEditPage) ✓
- §Routes table → Task 13 ✓
- §Router contract — instance preservation → Task 13 ✓
- §Stale-id fallback → Task 4 (helper), Task 12 (validation `$effect`) ✓
- §Expansion state derivation → Task 2 (helper), Tasks 10/11 (`expanded` derive) ✓
- §Dirty state contract → Tasks 3 (registry), 5 (copy), 6/7/10/11/12 (consumers + create-form shims), 10/11/12 (reorder/delete gating) ✓
- §Accordion a11y contract → Tasks 8 (slug-span suppression, scoped reorder labels, stable IDs from entity.id, slug aria-hidden, panel role=region), 9 (ItemRow parallels) ✓
- §Focus management table → Task 12 (focus `$effect` with capture-before-await + cancellation flag) ✓
- §Effect ordering + dep tuple → Task 12 (load → validation → focus, focus tracks `(routeBid, routeSid, tree)`) ✓
- §Item navigation → Task 9 (Open callback → SequenceAccordion → navigate) ✓
- §Reorder → Tasks 10 (items), 11 (sequences), 12 (blocks) — list-owner pattern ✓
- §Create / delete → Tasks 10 (items), 11 (sequences), 12 (blocks); deletes in 10/11 (sequence + item), 11 (block via SequenceAccordion's danger button — wait, block-delete lives in BlockAccordion: ✓), 12 (version) ✓
- §Empty states → Tasks 10, 11, 12 (3 places with editable/disabled copy variants) ✓
- §What gets deleted → Task 14 ✓
- §Race safety carry-over (savedVid/savedBid at await-start, LoadResult discrimination, reorder/delete recover via refetch) → Tasks 6, 10, 11, 12 ✓
- §Testing approach → Tasks 1–4 (pure helpers + vitest) ✓
- §Manual smoke checklist → Task 15 ✓
- §Implementation order — provider before consumers → Task 7 provides context, Tasks 10/11/12 consume ✓

**Placeholder scan:** none. Every step contains executable commands or exact code.

**Type consistency:**
- `labelFor(title, slug, fallback?)` consistent across Tasks 1, 8, 9 ✓
- `RegisteredTracker = { readonly isDirty: boolean }` matches slice-1 tracker getter shape and tracker-shim usage ✓
- `Expansion` shape consistent between Task 2 and Task 12 ✓
- `StaleFlags` / `StaleContext` / `StaleDeps` with `pushToast` injection consistent between Task 4 and Task 12 ✓
- `routeBid: string | null` / `routeSid: string | null` consistent across Tasks 7, 10, 11, 12 ✓
- `headerId` template literals (`block-${block.id}-header`, `seq-${seq.id}-header`) consistent between Tasks 8 (markup), 10/11 (id construction), 12 (focus-effect lookup) ✓
- `versionPermissions(v)` factory + `.canEdit*` properties consistent across Tasks 6, 7, 10, 11 ✓
- `mapCreateError(e, knownFields)` returning `{ fieldErrors, globalMessage }` consistent across Tasks 10, 11, 12 ✓
- `pushToast(msg, kind)` consistent across Tasks 4, 6, 7, 10, 11, 12 ✓

**Slice-1 contracts (verified at plan-writing time, after plan-review round 1):**
- `toasts` named export from `lib/events.ts` does NOT exist; plan uses `pushToast` from `stores/toasts.svelte`. ✓
- `versionPermissions` is a factory function; plan uses `versionPermissions(v).canEditX`. ✓
- `mapCreateError(e, knownFields)` signature; plan reads `globalMessage`, not `formError`. ✓
- Reorder endpoints: `/api/versions/:vid/blocks/reorder`, `/api/blocks/:bid/sequences/reorder`, `/api/sequences/:sid/items/reorder`. ✓
- Create endpoints: nested `/api/versions/:vid/blocks`, `/api/blocks/:bid/sequences`, `/api/sequences/:sid/items`. ✓
- `AdminTreeBlock.info` field (not `info_md`). ✓
- `AdminTree.course = { id, name, slug }`. ✓
- `ItemTypePicker` value narrowed to `'static_page' | 'video'` + per-type required field rendering. ✓
- Slice-1 header preserved: `← Versions` button + course name + version + state badge + disabled banner. ✓
- 3-way LoadResult save handling preserved. ✓
- Reorder/delete error recovery refetch preserved. ✓
- Slug `pattern="[a-z0-9]+(-[a-z0-9]+)*"` on every slug input. ✓
- Inline create-form dirty tracking uses synthesized `RegisteredTracker` shim (no `reset()`-on-keystroke). ✓
- Focus `$effect` reads `activeElement` BEFORE focus, captures vars before `await tick()`, returns cancellation cleanup. ✓
