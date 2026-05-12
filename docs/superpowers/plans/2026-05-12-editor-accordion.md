# Editor Accordion Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 4-page admin editor (Versions → Version → Block → Sequence → Item) into a single VersionEditPage with a 2-level accordion (blocks → sequences). Item editing stays on its own page.

**Architecture:** Svelte 5 runes throughout. Three routes (`/v/:vid`, `/blocks/:bid`, `/sequences/:sid`) all render the same VersionEditPage component — accordion expansion is derived directly from URL route params (no parallel state). Per-form dirty trackers register into a page-wide `SvelteSet` registry via `setContext`/`getContext` symbol key; DirtyGuard reads `() => isAnyDirty()` so its closure re-evaluates on every navigation. Stale-id fallback toasts + history-replaces to the nearest valid parent. Focus + scroll on deep-link / Back-Forward, but click-to-expand keeps focus on the clicked toggle (discriminator: compare `document.activeElement?.id` against the deepest expanded `headerId`).

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$props`, `$effect`, `$bindable`), TypeScript, Vite, vitest (no `@testing-library/svelte`; component-level behavior covered by manual smoke checklist). `svelte/reactivity` for `SvelteSet`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-10-editor-accordion-design.md` (slice 2, branch `frontend-admin-editor-accordion`).

**Working directory:** `/Users/svkucheryavski/Documents/Developing/mathion/frontend/`. All `npm` commands run from that directory.

**Test/check commands:**
- `npm test` — run vitest suite once
- `npm run check` — run svelte-check (type check)
- `npm run dev` — dev server for smoke checks

---

## File map

**New files:**
- `frontend/src/lib/labelFor.ts` — pure helper: title→slug→fallback chain
- `frontend/src/tests/labelFor.test.ts` — vitest coverage
- `frontend/src/lib/deriveExpansion.ts` — pure: lookup `(bid, sid, tree)` → entities + stale flags
- `frontend/src/tests/deriveExpansion.test.ts`
- `frontend/src/lib/dirtyRegistry.svelte.ts` — `createDirtyRegistry`, `DIRTY_REGISTRY_KEY`, types
- `frontend/src/tests/dirtyRegistry.test.ts`
- `frontend/src/lib/handleStaleIdFallback.ts` — pure side-effect (with injected toast/navigate)
- `frontend/src/tests/handleStaleIdFallback.test.ts`
- `frontend/src/components/editor/VersionMetaForm.svelte` — extracted version-meta editor
- `frontend/src/components/editor/AccordionHeader.svelte` — pure presentational header
- `frontend/src/components/editor/ItemRow.svelte` — one item row
- `frontend/src/components/editor/SequenceAccordion.svelte` — one sequence
- `frontend/src/components/editor/BlockAccordion.svelte` — one block

**Modified files:**
- `frontend/src/components/editor/DirtyGuard.svelte` — one-line copy update
- `frontend/src/pages/editor/VersionEditPage.svelte` — full rewrite: provider + accordion list + effects
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
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- labelFor
```

Expected: All tests FAIL with "Failed to resolve import '../lib/labelFor'" (file doesn't exist).

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/lib/labelFor.ts`:

```typescript
// labelFor returns a non-empty display name for an entity (block / sequence /
// item) suitable for ARIA labels and visible-title rendering. Falls back
// through title → slug → caller-supplied positional fallback → "untitled".
// Whitespace-only title/slug is treated as empty. Used by AccordionHeader
// and ItemRow to keep sighted and SR users seeing/hearing the same content.

export function labelFor(
  title: string | null | undefined,
  slug: string | null | undefined,
  fallback?: string,
): string {
  return title?.trim() || slug?.trim() || fallback || 'untitled';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm test -- labelFor
```

Expected: All 11 tests PASS.

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
    course: {
      id: 1,
      slug: 'cs101',
      title: 'CS 101',
      info_md: '',
      info_html: '',
      tagline: null,
      icon_url: null,
      ownerships: [],
    },
    version: {
      id: 10,
      course_id: 1,
      state: 'created',
      is_disabled: false,
      info_md: '',
      info_html: '',
      max_quiz_attempts: 3,
      created_at: '',
      published_at: null,
      archived_at: null,
      content_updated_at: '',
    },
    blocks: [
      {
        id: 100,
        version_id: 10,
        title: 'B1',
        slug: 'b1',
        order: 1,
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

**Files:**
- Create: `frontend/src/lib/handleStaleIdFallback.ts`
- Create: `frontend/src/tests/handleStaleIdFallback.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `frontend/src/tests/handleStaleIdFallback.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleStaleIdFallback } from '../lib/handleStaleIdFallback';

function setup() {
  const toast = { info: vi.fn(), success: vi.fn(), error: vi.fn() };
  const navigate = vi.fn();
  return { toast, navigate };
}

describe('handleStaleIdFallback', () => {
  it('staleBid=true: toast "Block not found." + navigate to /edit/v/{vid} with replace+force', () => {
    const { toast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: true, staleSid: false },
      { courseSlug: 'cs101', vid: '10', bid: null },
      { toast, navigate },
    );
    expect(toast.info).toHaveBeenCalledWith('Block not found.');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10', { replace: true, force: true });
  });

  it('staleSid=true (block intact): toast "Sequence not found." + navigate to block URL', () => {
    const { toast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: false, staleSid: true },
      { courseSlug: 'cs101', vid: '10', bid: '100' },
      { toast, navigate },
    );
    expect(toast.info).toHaveBeenCalledWith('Sequence not found.');
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10/blocks/100', { replace: true, force: true });
  });

  it('staleBid=true AND staleSid=true: staleBid wins — toast block, navigate to version', () => {
    const { toast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: true, staleSid: true },
      { courseSlug: 'cs101', vid: '10', bid: null },
      { toast, navigate },
    );
    expect(toast.info).toHaveBeenCalledWith('Block not found.');
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/courses/cs101/edit/v/10', { replace: true, force: true });
  });

  it('both false: no-op (no toast, no navigate)', () => {
    const { toast, navigate } = setup();
    handleStaleIdFallback(
      { staleBid: false, staleSid: false },
      { courseSlug: 'cs101', vid: '10', bid: '100' },
      { toast, navigate },
    );
    expect(toast.info).not.toHaveBeenCalled();
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
// toasts the user-facing message and navigates (replace + force) to the
// nearest valid parent URL. staleBid wins over staleSid because a missing
// block makes any nested sequence URL moot (cascade-deleted or
// unreachable). `force: true` bypasses DirtyGuard — prompting "save your
// changes?" on a deleted entity is pointless; Cancel would re-trigger the
// stale-id loop.

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
  toast: { info(msg: string): void };
  navigate: (path: string, opts: { replace: boolean; force: boolean }) => void;
};

export function handleStaleIdFallback(
  flags: StaleFlags,
  ctx: StaleContext,
  deps: StaleDeps,
): void {
  if (flags.staleBid) {
    deps.toast.info('Block not found.');
    deps.navigate(`/courses/${ctx.courseSlug}/edit/v/${ctx.vid}`, { replace: true, force: true });
    return;
  }
  if (flags.staleSid && ctx.bid !== null) {
    deps.toast.info('Sequence not found.');
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

Edit `frontend/src/components/editor/DirtyGuard.svelte`: change the string `'Discard unsaved changes?'` to `'Discard unsaved changes and continue?'`. Single-character literal change.

- [ ] **Step 3: Run type-check + tests to verify nothing breaks**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check && npm test
```

Expected: No type errors. All existing tests (including any DirtyGuard-related tests) still pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/DirtyGuard.svelte
git commit -m "fix(frontend): clarify DirtyGuard prompt — 'and continue?' makes OK behavior unambiguous"
```

---

## Task 6: `VersionMetaForm.svelte` — extracted version meta editor

**Context:** Today, the version-meta form lives inline at the top of `VersionEditPage.svelte`. We extract it into its own component so every "meta form" in slice 2 (version, block, sequence) is symmetric — its own file, owns its own tracker, registers via the page-wide dirty registry context.

**Files:**
- Create: `frontend/src/components/editor/VersionMetaForm.svelte`
- Reference (read-only): `frontend/src/pages/editor/VersionEditPage.svelte` (current slice-1 version-meta block to extract)

- [ ] **Step 1: Read the slice-1 VersionEditPage version-meta section**

```bash
sed -n '1,200p' /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/VersionEditPage.svelte
```

Capture: the `tracker = makeDirtyTracker({...})` setup, the title/info/max_quiz_attempts bindings, the Save handler with `mapCreateError`, the Discard handler, and the disabled-version permission check (`canEditTextFields`).

- [ ] **Step 2: Write VersionMetaForm.svelte**

Create `frontend/src/components/editor/VersionMetaForm.svelte`:

```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError } from '../../lib/formErrors';
  import { canEditTextFields } from '../../lib/versionPermissions';
  import { api } from '../../lib/api';
  import { toasts } from '../../lib/events';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import type { AdminTreeVersion } from '../../lib/types';

  type Props = {
    vid: number;
    version: AdminTreeVersion;
  };

  let { vid, version }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — VersionEditPage must wrap VersionMetaForm');

  const tracker = makeDirtyTracker({
    info_md: version.info_md ?? '',
    max_quiz_attempts: version.max_quiz_attempts,
  });

  // Rebuild tracker when vid changes (defensive).
  let trackerVid = $state(vid);
  $effect(() => {
    if (vid !== trackerVid) {
      tracker.reset({
        info_md: version.info_md ?? '',
        max_quiz_attempts: version.max_quiz_attempts,
      });
      trackerVid = vid;
    }
  });

  $effect(() => {
    dirty.register(tracker);
    return () => dirty.unregister(tracker);
  });

  const canEdit = $derived(canEditTextFields(version));

  let busy = $state(false);
  let fieldErrors = $state<Record<string, string>>({});
  let formError = $state<string | null>(null);

  async function save() {
    if (!tracker.isDirty || busy) return;
    busy = true;
    fieldErrors = {};
    formError = null;
    const savedVid = vid;
    try {
      await api.patch(`/api/versions/${savedVid}`, {
        info_md: tracker.current.info_md,
        max_quiz_attempts: tracker.current.max_quiz_attempts,
      });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'ok' && currentEditorVersion.value) {
        const cur = currentEditorVersion.value.version;
        tracker.reset({
          info_md: cur.info_md ?? '',
          max_quiz_attempts: cur.max_quiz_attempts,
        });
        toasts.success('Version saved.');
      } else if (result === 'error') {
        toasts.error('Could not refresh after save.');
      }
    } catch (e) {
      const mapped = mapCreateError(e);
      fieldErrors = mapped.fieldErrors;
      formError = mapped.formError;
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({
      info_md: version.info_md ?? '',
      max_quiz_attempts: version.max_quiz_attempts,
    });
    fieldErrors = {};
    formError = null;
  }
</script>

<section class="version-meta">
  <h2>Version</h2>
  <label>
    Info (markdown)
    <textarea
      bind:value={tracker.current.info_md}
      disabled={!canEdit || busy}
      rows="6"
    ></textarea>
    {#if fieldErrors.info_md}<span class="field-err">{fieldErrors.info_md}</span>{/if}
  </label>
  <label>
    Max quiz attempts
    <input
      type="number"
      min="1"
      bind:value={tracker.current.max_quiz_attempts}
      disabled={!canEdit || busy}
    />
    {#if fieldErrors.max_quiz_attempts}<span class="field-err">{fieldErrors.max_quiz_attempts}</span>{/if}
  </label>
  {#if formError}<p class="form-err">{formError}</p>{/if}
  <div class="actions">
    <button onclick={save} disabled={!canEdit || !tracker.isDirty || busy}>Save</button>
    <button onclick={discard} disabled={!tracker.isDirty || busy}>Discard</button>
  </div>
</section>
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/components/editor/VersionMetaForm.svelte
git commit -m "feat(frontend): extract VersionMetaForm component with context-based dirty registry"
```

---

## Task 7: `VersionEditPage` shell + dirty-registry provider

**Context:** Rewrite VersionEditPage as the new shell. This task lands the **provider before any accordion children consume context**. State-actions bar wiring stays from slice 1. No accordion children yet — those land in later tasks.

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte` (full rewrite)
- Reference: existing slice-1 version of the same file (read first)

- [ ] **Step 1: Read the current VersionEditPage to capture state-actions logic**

```bash
sed -n '1,300p' /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/VersionEditPage.svelte
```

Note: state-actions bar (publish/revert/disable/enable/delete) buttons + handlers; the `currentEditorVersion` store read pattern.

- [ ] **Step 2: Rewrite VersionEditPage shell**

Overwrite `frontend/src/pages/editor/VersionEditPage.svelte`:

```svelte
<script lang="ts">
  import { setContext, onDestroy } from 'svelte';
  import { createDirtyRegistry, DIRTY_REGISTRY_KEY } from '../../lib/dirtyRegistry.svelte';
  import { currentEditorVersion, loadAdminTree, clearEditorVersion } from '../../stores/currentEditorVersion.svelte';
  import { canEditStructure } from '../../lib/versionPermissions';
  import { navigate } from '../../lib/router.svelte';
  import { api } from '../../lib/api';
  import { toasts } from '../../lib/events';
  import DirtyGuard from '../../components/editor/DirtyGuard.svelte';
  import VersionMetaForm from '../../components/editor/VersionMetaForm.svelte';

  type Props = {
    courseSlug: string;
    versionId: string;
    blockId?: string;
    sequenceId?: string;
  };

  let { courseSlug, versionId, blockId, sequenceId }: Props = $props();

  const vid = $derived(Number(versionId));
  const routeBid = $derived(blockId ?? null);
  const routeSid = $derived(sequenceId ?? null);

  const dirtyRegistry = createDirtyRegistry();
  setContext(DIRTY_REGISTRY_KEY, dirtyRegistry);

  // Load $effect — keyed on vid ONLY (full hierarchical tree returned in one
  // response; expand/collapse doesn't refetch). Declared FIRST per
  // declaration-order discipline (see spec §"$effect declaration order").
  $effect(() => {
    if (!Number.isFinite(vid)) return;
    loadAdminTree(vid);
  });

  // Validation $effect — declared SECOND, before focus, so stale-id
  // correction lands before focus tries to find a toggle for a stale entity.
  // (Stale-id fallback wiring lands in a later task — leave empty for now.)

  // Focus $effect — declared THIRD. (Focus-and-scroll wiring lands in a
  // later task — leave empty for now.)

  onDestroy(clearEditorVersion);

  const tree = $derived(currentEditorVersion.value);
  const version = $derived(tree?.version ?? null);
  const canStructure = $derived(version ? canEditStructure(version) : false);

  let busy = $state(false);

  async function publish() {
    if (busy || !version) return;
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/publish`, {});
      await loadAdminTree(vid, { force: true });
      toasts.success('Version published.');
    } catch {
      toasts.error('Could not publish.');
    } finally {
      busy = false;
    }
  }

  async function revert() {
    if (busy || !version) return;
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/revert`, {});
      await loadAdminTree(vid, { force: true });
      toasts.success('Version reverted to draft.');
    } catch {
      toasts.error('Could not revert.');
    } finally {
      busy = false;
    }
  }

  async function disable() {
    if (busy || !version) return;
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/disable`, {});
      await loadAdminTree(vid, { force: true });
      toasts.success('Version disabled.');
    } catch {
      toasts.error('Could not disable.');
    } finally {
      busy = false;
    }
  }

  async function enable() {
    if (busy || !version) return;
    busy = true;
    try {
      await api.post(`/api/versions/${vid}/enable`, {});
      await loadAdminTree(vid, { force: true });
      toasts.success('Version enabled.');
    } catch {
      toasts.error('Could not enable.');
    } finally {
      busy = false;
    }
  }

  async function deleteVersion() {
    if (busy || !version) return;
    if (!confirm('Delete this version permanently?')) return;
    busy = true;
    try {
      await api.delete(`/api/versions/${vid}`);
      toasts.success('Version deleted.');
      navigate(`/courses/${courseSlug}/edit`);
    } catch {
      toasts.error('Could not delete.');
      busy = false;
    }
  }
</script>

<DirtyGuard isDirty={() => dirtyRegistry.isAnyDirty()} />

{#if tree && version}
  <header class="version-actions">
    <h1>Editing version {vid}</h1>
    {#if version.state === 'created' && !version.is_disabled}
      <button onclick={publish} disabled={busy}>Publish</button>
    {/if}
    {#if version.state === 'published' && !version.is_disabled}
      <button onclick={revert} disabled={busy}>Revert to draft</button>
    {/if}
    {#if !version.is_disabled}
      <button onclick={disable} disabled={busy}>Disable</button>
    {:else}
      <button onclick={enable} disabled={busy}>Enable</button>
    {/if}
    {#if version.is_disabled || version.state === 'created'}
      <button onclick={deleteVersion} disabled={busy} class="danger">Delete</button>
    {/if}
  </header>

  <VersionMetaForm {vid} {version} />

  <!-- Accordion list lands in Task 12. -->
{:else}
  <p>Loading version…</p>
{/if}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 4: Run dev server, smoke item 2 (lands on VersionEditPage with version meta)**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run dev
```

In browser: login → open an admin course → click a version → page loads with state-actions bar at top, version-meta form below. No blocks accordion yet (that's Task 12). DirtyGuard wired (typing in info textarea + clicking another link should prompt — best smoke once routing rebind also lands; for now, in-page navigation via the back arrow works as a manual check).

Stop the dev server after verification (Ctrl+C in the terminal running it).

- [ ] **Step 5: Commit**

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
  >↑</button>
  <button
    aria-label={`Move ${level} down: ${ariaName}`}
    onclick={onMoveDown}
    disabled={!canReorderDown || dirty || busy}
  >↓</button>
</div>
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

**Files:**
- Create: `frontend/src/components/editor/ItemRow.svelte`

- [ ] **Step 1: Write ItemRow**

Create `frontend/src/components/editor/ItemRow.svelte`:

```svelte
<script lang="ts">
  import { labelFor } from '../../lib/labelFor';
  import { navigate } from '../../lib/router.svelte';
  import { api } from '../../lib/api';
  import { toasts } from '../../lib/events';
  import { loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import type { AdminTreeItem } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    blockId: number;
    sequenceId: number;
    item: AdminTreeItem;
    index: number;
    canReorderUp: boolean;
    canReorderDown: boolean;
    canStructure: boolean;
    parentDirty: boolean;
  };

  let {
    courseSlug,
    vid,
    blockId,
    sequenceId,
    item,
    index,
    canReorderUp,
    canReorderDown,
    canStructure,
    parentDirty,
  }: Props = $props();

  const ariaName = $derived(labelFor(item.title, item.slug, `item ${index}`));

  let busy = $state(false);

  function openItem() {
    navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${blockId}/sequences/${sequenceId}/items/${item.id}`);
  }

  async function moveUp() {
    if (busy || !canReorderUp || parentDirty) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.post(`/api/items/${item.id}/move`, { direction: 'up' });
      await loadAdminTree(savedVid, { force: true });
    } catch {
      toasts.error('Could not reorder.');
    } finally {
      busy = false;
    }
  }

  async function moveDown() {
    if (busy || !canReorderDown || parentDirty) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.post(`/api/items/${item.id}/move`, { direction: 'down' });
      await loadAdminTree(savedVid, { force: true });
    } catch {
      toasts.error('Could not reorder.');
    } finally {
      busy = false;
    }
  }

  async function deleteItem() {
    if (busy || !canStructure) return;
    if (!confirm(`Delete "${ariaName}"?`)) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.delete(`/api/items/${item.id}`);
      await loadAdminTree(savedVid, { force: true });
      toasts.success('Item deleted.');
    } catch {
      toasts.error('Could not delete.');
    } finally {
      busy = false;
    }
  }
</script>

<div class="item-row">
  <span class="type-icon" aria-hidden="true">{item.type === 'video' ? '🎬' : item.type === 'quiz' ? '❓' : item.type === 'interactive_app' ? '⚙️' : '📄'}</span>
  <span class="item-title">
    {item.title?.trim() || item.slug?.trim() || `(item ${index})`}
  </span>
  {#if item.title?.trim() && item.slug?.trim()}
    <span class="item-slug" aria-hidden="true">/{item.slug}</span>
  {/if}
  {#if canStructure}
    <button
      aria-label={`Move item up: ${ariaName}`}
      onclick={moveUp}
      disabled={!canReorderUp || parentDirty || busy}
    >↑</button>
    <button
      aria-label={`Move item down: ${ariaName}`}
      onclick={moveDown}
      disabled={!canReorderDown || parentDirty || busy}
    >↓</button>
  {/if}
  <button
    aria-label={`Open ${ariaName}`}
    onclick={openItem}
  >Open</button>
  {#if canStructure}
    <button
      aria-label={`Delete ${ariaName}`}
      onclick={deleteItem}
      disabled={busy}
      class="danger"
    >Delete</button>
  {/if}
</div>
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
git commit -m "feat(frontend): add ItemRow component with scoped reorder/Open/Delete a11y labels"
```

---

## Task 10: `SequenceAccordion.svelte` — one sequence

**Context:** Consumes dirty-registry context, renders AccordionHeader, owns sequence-meta tracker, hosts items list + create-item form. Body unmounts via `{#if expanded}` when collapsed — tracker registered/unregistered in `$effect` symmetry.

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
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError } from '../../lib/formErrors';
  import { canEditTextFields, canEditStructure } from '../../lib/versionPermissions';
  import { navigate } from '../../lib/router.svelte';
  import { api } from '../../lib/api';
  import { toasts } from '../../lib/events';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
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
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — SequenceAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid && String(seq.id) === routeSid);
  const headerId = `seq-${String(seq.id)}-header`;
  const panelId = `seq-${String(seq.id)}-panel`;

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const canEdit = $derived(version ? canEditTextFields(version) : false);
  const canStructure = $derived(version ? canEditStructure(version) : false);

  const tracker = makeDirtyTracker({
    title: seq.title ?? '',
  });

  let trackerSid = $state(seq.id);
  $effect(() => {
    if (seq.id !== trackerSid) {
      tracker.reset({ title: seq.title ?? '' });
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
      navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    } else {
      navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}/sequences/${seq.id}`);
    }
  }

  let busy = $state(false);
  let fieldErrors = $state<Record<string, string>>({});
  let formError = $state<string | null>(null);

  async function save() {
    if (!tracker.isDirty || busy) return;
    busy = true;
    fieldErrors = {};
    formError = null;
    const savedVid = vid;
    const savedSid = seq.id;
    try {
      await api.patch(`/api/sequences/${savedSid}`, { title: tracker.current.title });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'ok' && currentEditorVersion.value) {
        const fresh = currentEditorVersion.value.blocks
          .find((b) => b.id === block.id)?.sequences
          .find((s) => s.id === savedSid);
        if (fresh) {
          tracker.reset({ title: fresh.title ?? '' });
          toasts.success('Sequence saved.');
        }
      }
    } catch (e) {
      const mapped = mapCreateError(e);
      fieldErrors = mapped.fieldErrors;
      formError = mapped.formError;
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ title: seq.title ?? '' });
    fieldErrors = {};
    formError = null;
  }

  async function moveUp() {
    if (busy || tracker.isDirty || index <= 1) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.post(`/api/sequences/${seq.id}/move`, { direction: 'up' });
      await loadAdminTree(savedVid, { force: true });
    } catch {
      toasts.error('Could not reorder.');
    } finally {
      busy = false;
    }
  }

  async function moveDown() {
    if (busy || tracker.isDirty || index >= sequenceCount) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.post(`/api/sequences/${seq.id}/move`, { direction: 'down' });
      await loadAdminTree(savedVid, { force: true });
    } catch {
      toasts.error('Could not reorder.');
    } finally {
      busy = false;
    }
  }

  async function deleteSeq() {
    if (busy || !canStructure || tracker.isDirty) return;
    if (seq.items.length > 0) {
      toasts.error('Remove all items first.');
      return;
    }
    if (!confirm(`Delete sequence "${seq.title || seq.slug}"?`)) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.delete(`/api/sequences/${seq.id}`);
      await loadAdminTree(savedVid, { force: true });
      toasts.success('Sequence deleted.');
      navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    } catch {
      toasts.error('Could not delete.');
    } finally {
      busy = false;
    }
  }

  // Inline create-item form
  let creatingItem = $state(false);
  let newItemTitle = $state('');
  let newItemSlug = $state('');
  let newItemType = $state<'static_page' | 'video' | 'quiz' | 'interactive_app' | null>(null);
  let createFieldErrors = $state<Record<string, string>>({});
  let createFormError = $state<string | null>(null);
  let createBusy = $state(false);
  const createTracker = makeDirtyTracker({ title: '', slug: '', type: '' });

  $effect(() => {
    if (!creatingItem) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  $effect(() => {
    if (creatingItem) {
      createTracker.reset({
        title: newItemTitle,
        slug: newItemSlug,
        type: newItemType ?? '',
      });
    }
  });

  function openCreateForm() {
    newItemTitle = '';
    newItemSlug = '';
    newItemType = null;
    createFieldErrors = {};
    createFormError = null;
    creatingItem = true;
  }

  function cancelCreate() {
    creatingItem = false;
  }

  async function submitCreate() {
    if (createBusy || !newItemType || !newItemSlug.trim()) return;
    createBusy = true;
    createFieldErrors = {};
    createFormError = null;
    const savedVid = vid;
    try {
      const payload: Record<string, unknown> = {
        sequence_id: seq.id,
        title: newItemTitle.trim(),
        slug: newItemSlug.trim(),
        type: newItemType,
      };
      if (newItemType === 'static_page') {
        payload.content_md = `# ${newItemTitle.trim() || newItemSlug.trim()}`;
      }
      await api.post('/api/items', payload);
      await loadAdminTree(savedVid, { force: true });
      creatingItem = false;
      toasts.success('Item created.');
    } catch (e) {
      const mapped = mapCreateError(e);
      createFieldErrors = mapped.fieldErrors;
      createFormError = mapped.formError;
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
    canReorderUp={canStructure && index > 1 && !tracker.isDirty}
    canReorderDown={canStructure && index < sequenceCount && !tracker.isDirty}
    onToggle={toggle}
    onMoveUp={moveUp}
    onMoveDown={moveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
      <label>
        Sequence title
        <input bind:value={tracker.current.title} disabled={!canEdit || busy} />
        {#if fieldErrors.title}<span class="field-err">{fieldErrors.title}</span>{/if}
      </label>
      {#if formError}<p class="form-err">{formError}</p>{/if}
      <div class="actions">
        <button onclick={save} disabled={!canEdit || !tracker.isDirty || busy}>Save</button>
        <button onclick={discard} disabled={!tracker.isDirty || busy}>Discard</button>
      </div>

      <h4>Items</h4>
      {#if seq.items.length === 0}
        <p class="empty-state">
          {canStructure ? 'No items yet — pick a type below to add one.' : 'No items.'}
        </p>
      {:else}
        <ul class="items-list">
          {#each seq.items as item, i (item.id)}
            <li>
              <ItemRow
                {courseSlug}
                {vid}
                blockId={block.id}
                sequenceId={seq.id}
                {item}
                index={i + 1}
                canReorderUp={canStructure && i > 0 && !tracker.isDirty}
                canReorderDown={canStructure && i < seq.items.length - 1 && !tracker.isDirty}
                {canStructure}
                parentDirty={tracker.isDirty}
              />
            </li>
          {/each}
        </ul>
      {/if}

      {#if canStructure}
        {#if !creatingItem}
          <button onclick={openCreateForm} disabled={tracker.isDirty}>+ New item</button>
        {:else}
          <div class="create-form">
            <ItemTypePicker bind:value={newItemType} />
            {#if newItemType}
              <label>
                Title
                <input bind:value={newItemTitle} />
                {#if createFieldErrors.title}<span class="field-err">{createFieldErrors.title}</span>{/if}
              </label>
              <label>
                Slug
                <input bind:value={newItemSlug} />
                {#if createFieldErrors.slug}<span class="field-err">{createFieldErrors.slug}</span>{/if}
              </label>
              {#if createFormError}<p class="form-err">{createFormError}</p>{/if}
              <button onclick={submitCreate} disabled={createBusy || !newItemSlug.trim()}>Create</button>
              <button onclick={cancelCreate} disabled={createBusy}>Cancel</button>
            {/if}
          </div>
        {/if}
      {/if}

      {#if canStructure}
        <button onclick={deleteSeq} disabled={busy || tracker.isDirty || seq.items.length > 0} class="danger">Delete sequence</button>
      {/if}
    </div>
  {/if}
</div>
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
git commit -m "feat(frontend): add SequenceAccordion with sequence-meta + items + create form"
```

---

## Task 11: `BlockAccordion.svelte` — one block

**Files:**
- Create: `frontend/src/components/editor/BlockAccordion.svelte`

- [ ] **Step 1: Write BlockAccordion**

Create `frontend/src/components/editor/BlockAccordion.svelte`:

```svelte
<script lang="ts">
  import { getContext } from 'svelte';
  import AccordionHeader from './AccordionHeader.svelte';
  import SequenceAccordion from './SequenceAccordion.svelte';
  import { DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../../lib/dirtyRegistry.svelte';
  import { makeDirtyTracker } from '../../lib/dirty.svelte';
  import { mapCreateError } from '../../lib/formErrors';
  import { canEditTextFields, canEditStructure } from '../../lib/versionPermissions';
  import { navigate } from '../../lib/router.svelte';
  import { api } from '../../lib/api';
  import { toasts } from '../../lib/events';
  import { currentEditorVersion, loadAdminTree } from '../../stores/currentEditorVersion.svelte';
  import type { AdminTreeBlock } from '../../lib/types';

  type Props = {
    courseSlug: string;
    vid: number;
    block: AdminTreeBlock;
    index: number;
    blockCount: number;
    routeBid: string | null;
    routeSid: string | null;
  };

  let {
    courseSlug,
    vid,
    block,
    index,
    blockCount,
    routeBid,
    routeSid,
  }: Props = $props();

  const dirty = getContext<DirtyRegistry>(DIRTY_REGISTRY_KEY);
  if (!dirty) throw new Error('DIRTY_REGISTRY_KEY context missing — BlockAccordion must mount under VersionEditPage');

  const expanded = $derived(String(block.id) === routeBid);
  const headerId = `block-${String(block.id)}-header`;
  const panelId = `block-${String(block.id)}-panel`;

  const version = $derived(currentEditorVersion.value?.version ?? null);
  const canEdit = $derived(version ? canEditTextFields(version) : false);
  const canStructure = $derived(version ? canEditStructure(version) : false);

  const tracker = makeDirtyTracker({
    title: block.title ?? '',
    info_md: '',
  });

  let trackerBid = $state(block.id);
  $effect(() => {
    if (block.id !== trackerBid) {
      tracker.reset({ title: block.title ?? '', info_md: '' });
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
      navigate(`/courses/${courseSlug}/edit/v/${vid}`);
    } else {
      navigate(`/courses/${courseSlug}/edit/v/${vid}/blocks/${block.id}`);
    }
  }

  let busy = $state(false);
  let fieldErrors = $state<Record<string, string>>({});
  let formError = $state<string | null>(null);

  async function save() {
    if (!tracker.isDirty || busy) return;
    busy = true;
    fieldErrors = {};
    formError = null;
    const savedVid = vid;
    const savedBid = block.id;
    try {
      await api.patch(`/api/blocks/${savedBid}`, { title: tracker.current.title });
      const result = await loadAdminTree(savedVid, { force: true });
      if (result === 'ok' && currentEditorVersion.value) {
        const fresh = currentEditorVersion.value.blocks.find((b) => b.id === savedBid);
        if (fresh) {
          tracker.reset({ title: fresh.title ?? '', info_md: '' });
          toasts.success('Block saved.');
        }
      }
    } catch (e) {
      const mapped = mapCreateError(e);
      fieldErrors = mapped.fieldErrors;
      formError = mapped.formError;
    } finally {
      busy = false;
    }
  }

  function discard() {
    tracker.reset({ title: block.title ?? '', info_md: '' });
    fieldErrors = {};
    formError = null;
  }

  async function moveUp() {
    if (busy || tracker.isDirty || index <= 1) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.post(`/api/blocks/${block.id}/move`, { direction: 'up' });
      await loadAdminTree(savedVid, { force: true });
    } catch {
      toasts.error('Could not reorder.');
    } finally {
      busy = false;
    }
  }

  async function moveDown() {
    if (busy || tracker.isDirty || index >= blockCount) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.post(`/api/blocks/${block.id}/move`, { direction: 'down' });
      await loadAdminTree(savedVid, { force: true });
    } catch {
      toasts.error('Could not reorder.');
    } finally {
      busy = false;
    }
  }

  async function deleteBlock() {
    if (busy || !canStructure || tracker.isDirty) return;
    if (block.sequences.length > 0) {
      toasts.error('Remove all sequences first.');
      return;
    }
    if (!confirm(`Delete block "${block.title || block.slug}"?`)) return;
    busy = true;
    const savedVid = vid;
    try {
      await api.delete(`/api/blocks/${block.id}`);
      await loadAdminTree(savedVid, { force: true });
      toasts.success('Block deleted.');
      navigate(`/courses/${courseSlug}/edit/v/${vid}`);
    } catch {
      toasts.error('Could not delete.');
    } finally {
      busy = false;
    }
  }

  // Inline create-sequence form
  let creatingSeq = $state(false);
  let newSeqTitle = $state('');
  let newSeqSlug = $state('');
  let createFieldErrors = $state<Record<string, string>>({});
  let createFormError = $state<string | null>(null);
  let createBusy = $state(false);
  const createTracker = makeDirtyTracker({ title: '', slug: '' });

  $effect(() => {
    if (!creatingSeq) return;
    dirty.register(createTracker);
    return () => dirty.unregister(createTracker);
  });

  $effect(() => {
    if (creatingSeq) {
      createTracker.reset({ title: newSeqTitle, slug: newSeqSlug });
    }
  });

  function openCreateForm() {
    newSeqTitle = '';
    newSeqSlug = '';
    createFieldErrors = {};
    createFormError = null;
    creatingSeq = true;
  }

  function cancelCreate() {
    creatingSeq = false;
  }

  async function submitCreate() {
    if (createBusy || !newSeqSlug.trim()) return;
    createBusy = true;
    createFieldErrors = {};
    createFormError = null;
    const savedVid = vid;
    try {
      await api.post('/api/sequences', {
        block_id: block.id,
        title: newSeqTitle.trim(),
        slug: newSeqSlug.trim(),
      });
      await loadAdminTree(savedVid, { force: true });
      creatingSeq = false;
      toasts.success('Sequence created.');
    } catch (e) {
      const mapped = mapCreateError(e);
      createFieldErrors = mapped.fieldErrors;
      createFormError = mapped.formError;
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
    canReorderUp={canStructure && index > 1 && !tracker.isDirty}
    canReorderDown={canStructure && index < blockCount && !tracker.isDirty}
    onToggle={toggle}
    onMoveUp={moveUp}
    onMoveDown={moveDown}
  />

  {#if expanded}
    <div id={panelId} role="region" aria-labelledby={headerId} class="accordion-body">
      <label>
        Block title
        <input bind:value={tracker.current.title} disabled={!canEdit || busy} />
        {#if fieldErrors.title}<span class="field-err">{fieldErrors.title}</span>{/if}
      </label>
      {#if formError}<p class="form-err">{formError}</p>{/if}
      <div class="actions">
        <button onclick={save} disabled={!canEdit || !tracker.isDirty || busy}>Save</button>
        <button onclick={discard} disabled={!tracker.isDirty || busy}>Discard</button>
      </div>

      <h3>Sequences</h3>
      {#if block.sequences.length === 0}
        <p class="empty-state">
          {canStructure ? 'No sequences yet.' : 'No sequences.'}
        </p>
      {:else}
        <ul class="sequences-list">
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
              />
            </li>
          {/each}
        </ul>
      {/if}

      {#if canStructure}
        {#if !creatingSeq}
          <button onclick={openCreateForm} disabled={tracker.isDirty}>+ New sequence</button>
        {:else}
          <div class="create-form">
            <label>
              Title
              <input bind:value={newSeqTitle} />
              {#if createFieldErrors.title}<span class="field-err">{createFieldErrors.title}</span>{/if}
            </label>
            <label>
              Slug
              <input bind:value={newSeqSlug} />
              {#if createFieldErrors.slug}<span class="field-err">{createFieldErrors.slug}</span>{/if}
            </label>
            {#if createFormError}<p class="form-err">{createFormError}</p>{/if}
            <button onclick={submitCreate} disabled={createBusy || !newSeqSlug.trim()}>Create</button>
            <button onclick={cancelCreate} disabled={createBusy}>Cancel</button>
          </div>
        {/if}
      {/if}

      {#if canStructure}
        <button onclick={deleteBlock} disabled={busy || tracker.isDirty || block.sequences.length > 0} class="danger">Delete block</button>
      {/if}
    </div>
  {/if}
</div>
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
git commit -m "feat(frontend): add BlockAccordion with block-meta + nested sequences + create form"
```

---

## Task 12: VersionEditPage accordion wiring + stale-id $effect + focus $effect

**Context:** The shell from Task 7 had placeholder slots for the accordion list, validation `$effect`, and focus `$effect`. This task fills them all in, respecting **declaration order: load → validation → focus** (per spec).

**Files:**
- Modify: `frontend/src/pages/editor/VersionEditPage.svelte`

- [ ] **Step 1: Read the current shell**

```bash
sed -n '1,200p' /Users/svkucheryavski/Documents/Developing/mathion/frontend/src/pages/editor/VersionEditPage.svelte
```

- [ ] **Step 2: Add imports + validation/focus effects + accordion list**

Apply the following changes to `frontend/src/pages/editor/VersionEditPage.svelte`:

a) Add imports at the top of `<script>`:

```typescript
  import { tick } from 'svelte';
  import { deriveExpansion } from '../../lib/deriveExpansion';
  import { handleStaleIdFallback } from '../../lib/handleStaleIdFallback';
  import { mapCreateError } from '../../lib/formErrors';
  import BlockAccordion from '../../components/editor/BlockAccordion.svelte';
```

b) After the load `$effect`, insert the validation `$effect` (declared SECOND):

```typescript
  $effect(() => {
    const expansion = deriveExpansion(routeBid, routeSid, currentEditorVersion.value);
    if (expansion.staleBid || expansion.staleSid) {
      handleStaleIdFallback(
        { staleBid: expansion.staleBid, staleSid: expansion.staleSid },
        { courseSlug, vid: String(vid), bid: routeBid },
        { toast: toasts, navigate },
      );
    }
  });
```

c) After the validation `$effect`, insert the focus `$effect` (declared THIRD). It depends on `(routeBid, routeSid, tree)`:

```typescript
  $effect(() => {
    // Track all three dependencies.
    const bid = routeBid;
    const sid = routeSid;
    const t = currentEditorVersion.value;
    if (!t) return;
    // Resolve deepest expanded toggle's headerId.
    let headerId: string | null = null;
    if (bid !== null) {
      const block = t.blocks.find((b) => String(b.id) === bid);
      if (block) {
        if (sid !== null) {
          const seq = block.sequences.find((s) => String(s.id) === sid);
          if (seq) headerId = `seq-${String(seq.id)}-header`;
          else headerId = `block-${String(block.id)}-header`;
        } else {
          headerId = `block-${String(block.id)}-header`;
        }
      }
    }
    if (!headerId) return;

    void (async () => {
      await tick();
      // Read activeElement BEFORE any focus() call — otherwise the discriminator is self-referential.
      const active = document.activeElement?.id ?? null;
      if (active === headerId) return; // user-click branch — focus already correct.
      const el = document.getElementById(headerId);
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
    })();
  });
```

d) Add `import { makeDirtyTracker } from '../../lib/dirty.svelte';` to the imports block at the top of `<script>`.

Then add inline create-block form state and the create-block tracker + register/unregister effects inside `<script>`, after the other state declarations:

```typescript
  let creatingBlock = $state(false);
  let newBlockTitle = $state('');
  let newBlockSlug = $state('');
  let createFieldErrors = $state<Record<string, string>>({});
  let createFormError = $state<string | null>(null);
  let createBusy = $state(false);

  const createBlockTracker = makeDirtyTracker({ title: '', slug: '' });
```

Add the register effect and handlers:

```typescript
  $effect(() => {
    if (!creatingBlock) return;
    dirtyRegistry.register(createBlockTracker);
    return () => dirtyRegistry.unregister(createBlockTracker);
  });

  $effect(() => {
    if (creatingBlock) {
      createBlockTracker.reset({ title: newBlockTitle, slug: newBlockSlug });
    }
  });

  function openCreateBlockForm() {
    newBlockTitle = '';
    newBlockSlug = '';
    createFieldErrors = {};
    createFormError = null;
    creatingBlock = true;
  }

  function cancelCreateBlock() {
    creatingBlock = false;
  }

  async function submitCreateBlock() {
    if (createBusy || !newBlockSlug.trim()) return;
    createBusy = true;
    createFieldErrors = {};
    createFormError = null;
    const savedVid = vid;
    try {
      await api.post('/api/blocks', {
        version_id: savedVid,
        title: newBlockTitle.trim(),
        slug: newBlockSlug.trim(),
      });
      await loadAdminTree(savedVid, { force: true });
      creatingBlock = false;
      toasts.success('Block created.');
    } catch (e) {
      const mapped = mapCreateError(e);
      createFieldErrors = mapped.fieldErrors;
      createFormError = mapped.formError;
    } finally {
      createBusy = false;
    }
  }
```

e) Replace the markup body (between `<VersionMetaForm />` and the trailing `{:else}` branch) with the blocks accordion list + create-block form:

```svelte
  <VersionMetaForm {vid} {version} />

  <section class="blocks-section">
    <h2>Blocks</h2>
    {#if tree.blocks.length === 0}
      <p class="empty-state">
        {canStructure ? 'This version has no blocks yet.' : 'This version has no blocks.'}
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
            />
          </li>
        {/each}
      </ul>
    {/if}

    {#if canStructure}
      {#if !creatingBlock}
        <button onclick={openCreateBlockForm}>+ New block</button>
      {:else}
        <div class="create-form">
          <label>
            Title
            <input bind:value={newBlockTitle} />
            {#if createFieldErrors.title}<span class="field-err">{createFieldErrors.title}</span>{/if}
          </label>
          <label>
            Slug
            <input bind:value={newBlockSlug} />
            {#if createFieldErrors.slug}<span class="field-err">{createFieldErrors.slug}</span>{/if}
          </label>
          {#if createFormError}<p class="form-err">{createFormError}</p>{/if}
          <button onclick={submitCreateBlock} disabled={createBusy || !newBlockSlug.trim()}>Create</button>
          <button onclick={cancelCreateBlock} disabled={createBusy}>Cancel</button>
        </div>
      {/if}
    {/if}
  </section>
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add frontend/src/pages/editor/VersionEditPage.svelte
git commit -m "feat(frontend): wire VersionEditPage accordion + stale-id + focus effects"
```

---

## Task 13: Routes + componentMap rebinding

**Context:** Three routes (`/v/:vid`, `/blocks/:bid`, `/sequences/:sid`) need to point to `VersionEditPage`. `App.svelte` removes references to the deleted page components.

**Files:**
- Modify: `frontend/src/routes.ts`
- Modify: `frontend/src/App.svelte`

- [ ] **Step 1: Update `routes.ts`**

Change three route entries in `frontend/src/routes.ts` so they all map to `'VersionEditPage'`:

```typescript
  { path: '/courses/:courseSlug/edit/v/:versionId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId', component: 'VersionEditPage', auth: true },
  { path: '/courses/:courseSlug/edit/v/:versionId/blocks/:blockId/sequences/:sequenceId/items/:itemId', component: 'ItemEditPage', auth: true },
```

Leave the ItemEditPage entry as-is.

- [ ] **Step 2: Update `App.svelte`**

In `frontend/src/App.svelte`:

a) Remove the imports for `BlockEditPage` and `SequenceEditPage`.

b) Remove the `BlockEditPage` and `SequenceEditPage` entries from `componentMap`.

- [ ] **Step 3: Type-check**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion/frontend
npm run check
```

Expected: No type errors (the deleted page files don't exist yet — they'll be deleted in Task 14, but svelte-check should pass once the imports are removed).

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

Expected: only matches inside the page files themselves (which we're about to delete). Zero references in routes.ts, App.svelte, or anywhere else.

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

Expected: No type errors. All existing tests pass (plus the new ones added in Tasks 1–4).

- [ ] **Step 4: Commit**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git add -u frontend/src/pages/editor/
git commit -m "refactor(frontend): delete BlockEditPage and SequenceEditPage — merged into accordion"
```

---

## Task 15: Manual smoke pass

**Context:** The spec defines a smoke checklist of 28+ items (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14b, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 26b, 27, 28, 28b, 28c, 28d). This task runs through them all in the dev environment and records any defect to be fixed before merging.

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

Open the spec at `docs/superpowers/specs/2026-05-10-editor-accordion-design.md` to the "Manual smoke checklist (slice 2)" section. Execute each numbered item in a real browser (Chrome or Firefox; for items 18/24/25/28/28b/28c/28d a screen reader — VoiceOver on macOS — is needed). Mark items pass/fail; for any fail, file a separate fix task and re-run the affected item.

Items to execute, in order:

1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14b, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 26b, 27, 28, 28b, 28c, 28d.

- [ ] **Step 4: Record results**

If any item fails, fix the underlying defect (open the relevant source file from the file-map at the top of this plan and modify it), then commit:

```bash
git add <file(s)>
git commit -m "fix(frontend): <defect description from smoke item N>"
```

If all items pass, this task is complete — no commit needed.

---

## Task 16: Final type-check + full vitest run

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

Expected: all tests pass (including the 4 new test files: labelFor, deriveExpansion, dirtyRegistry, handleStaleIdFallback). Existing tests (dirty, router, formErrors, etc.) still green.

- [ ] **Step 3: Verify branch is ready to merge**

```bash
cd /Users/svkucheryavski/Documents/Developing/mathion
git log --oneline main..frontend-admin-editor-accordion | head -30
git status
```

Expected: clean working tree, commits visible from Task 1 through Task 15.

---

## Self-review

Before handing off to subagent-driven-development, the planner ran a self-review against the spec:

**Spec coverage:**
- §Goal / §Architecture overview → Task 7 (shell), Task 12 (accordion wiring) ✓
- §Components table → Tasks 6, 8, 9, 10, 11 (VersionMetaForm, AccordionHeader, ItemRow, SequenceAccordion, BlockAccordion) + Task 7 + Task 12 (VersionEditPage) ✓
- §Routes table → Task 13 ✓
- §Router contract — instance preservation → Task 13 (rebinding three routes to same component) ✓
- §Stale-id fallback → Task 4 (helper), Task 12 (validation `$effect` wiring) ✓
- §Expansion state derivation → Task 2 (helper), Task 11/10 (header `expanded={...}` derive) ✓
- §Dirty state contract — registry, single-prompt-path, prompt copy, over-prompt-accepted, reorder/delete gating → Tasks 3 (registry), 5 (copy), 6/7/10/11 (consumers), 9/10/11 (reorder/delete gating) ✓
- §Accordion a11y contract — slug-span rule, scoped reorder labels, stable IDs, `aria-hidden` slug, panel `role="region"` → Tasks 8, 9, 10, 11 ✓
- §Focus management table → Task 12 (focus `$effect`) ✓
- §Effect ordering + dep tuple → Task 12 explicitly orders load → validation → focus ✓
- §Item navigation → Task 9 (ItemRow Open button → navigate) ✓
- §Reorder → Tasks 9, 10, 11 (all three levels) ✓
- §Create / delete → Tasks 9, 10, 11, 12 ✓
- §Empty states → Tasks 10, 11, 12 (3 places with editable/disabled copy variants) ✓
- §What gets deleted → Task 14 ✓
- §What stays unchanged from slice 1 → preserved by not modifying those files; verified by Task 16 full test run ✓
- §Race safety carry-over → Tasks 6/10/11 (savedVid/savedBid capture at await-start), 12 (LoadResult discrimination via loadAdminTree) ✓
- §Testing approach — pure helpers + vitest → Tasks 1–4 ✓
- §Manual smoke checklist (28+ items) → Task 15 ✓
- §Implementation order — provider before consumers → Task 7 provides context, Tasks 10/11/12 consume ✓

**Placeholder scan:** none. Every step contains either an executable command, exact code, or an explicit pass/fail criterion.

**Type consistency:**
- `labelFor(title, slug, fallback?)` signature consistent across Tasks 1, 8, 9, 10, 11 ✓
- `RegisteredTracker = { readonly isDirty: boolean }` matches the slice-1 tracker getter shape ✓
- `Expansion` return shape from `deriveExpansion` matches Task 12 consumer ✓
- `StaleFlags` / `StaleContext` / `StaleDeps` triple in Task 4 matches Task 12 caller ✓
- `routeBid: string | null` / `routeSid: string | null` consistent across Tasks 7, 10, 11, 12 ✓
- `headerId = block-${block.id}-header` / `seq-${seq.id}-header` consistent between Tasks 8 (header markup), 10/11 (id construction), 12 (focus-effect lookup) ✓

Plan is internally consistent and spec-complete.
