import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AccordionHeader from '../components/editor/AccordionHeader.svelte';

// Mount-based regression test for the per-arrow visibility rule
// established during slice-2 smoke (commits 5bc4818 / 775f1bc, see
// spec §"Hide vs disable for reorder ↑/↓"):
//
//   - canReorderUp / canReorderDown gate render: when false (the
//     version is not structurally editable, or this row is at the
//     boundary in that direction), the arrow is omitted from the DOM.
//   - dirty / busy gate interaction: when those are true and the
//     arrow is rendered, it's disabled with a "Save or discard
//     changes first" tooltip — the user can recover, so the affordance
//     stays visible.
//
// ItemRow follows the same pattern; this file covers AccordionHeader
// directly, and the equivalent ItemRow logic is exercised
// transitively via SequenceAccordion's smoke pass.
//
// Why `mount()` here vs. the `$effect.root()` pattern in the rest of
// the test suite (see observeIsDirty.svelte.ts): we need DOM assertions
// (querySelector for buttons), so we render the component into a real
// jsdom container. `$effect.root()` is the right tool only when the
// test helper creates effects *outside* of any component — for a
// presentational-output test like this one, `mount()` is correct, and
// `unmount(cmp)` takes care of disposing any internal `$effect`s the
// component itself sets up.

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

function mountHeader(overrides: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(AccordionHeader, {
    target,
    props: {
      headerId: 'h1',
      panelId: 'p1',
      level: 'block',
      title: 'Intro',
      slug: 'intro',
      index: 2,           // middle row by default
      expanded: false,
      dirty: false,
      busy: false,
      canReorderUp: true,
      canReorderDown: true,
      onToggle: () => {},
      onMoveUp: () => {},
      onMoveDown: () => {},
      ...overrides,
    },
  });
  cleanup = () => { void unmount(cmp); };
  flushSync();
  return target;
}

describe('AccordionHeader', () => {
  it('hides both reorder buttons when canReorderUp and canReorderDown are false (e.g., on a published version)', () => {
    const target = mountHeader({
      canReorderUp: false,
      canReorderDown: false,
    });
    // Toggle remains so the user can still expand/read the row.
    expect(target.querySelector('#h1')).not.toBeNull();
    expect(target.querySelector('[aria-label^="Move block up"]')).toBeNull();
    expect(target.querySelector('[aria-label^="Move block down"]')).toBeNull();
  });

  it('renders both reorder buttons on a middle row of an editable version', () => {
    const target = mountHeader({
      canReorderUp: true,
      canReorderDown: true,
    });
    expect(target.querySelector('[aria-label^="Move block up"]')).not.toBeNull();
    expect(target.querySelector('[aria-label^="Move block down"]')).not.toBeNull();
  });

  it('hides the up arrow on the first row (nothing above to swap with)', () => {
    const target = mountHeader({
      canReorderUp: false,
      canReorderDown: true,
    });
    expect(target.querySelector('[aria-label^="Move block up"]')).toBeNull();
    expect(target.querySelector('[aria-label^="Move block down"]')).not.toBeNull();
  });

  it('hides the down arrow on the last row (nothing below to swap with)', () => {
    const target = mountHeader({
      canReorderUp: true,
      canReorderDown: false,
    });
    expect(target.querySelector('[aria-label^="Move block up"]')).not.toBeNull();
    expect(target.querySelector('[aria-label^="Move block down"]')).toBeNull();
  });

  it('renders both arrows but disables them when dirty (so the tooltip remains discoverable — smoke item 22)', () => {
    const target = mountHeader({
      canReorderUp: true,
      canReorderDown: true,
      dirty: true,
    });
    const up = target.querySelector<HTMLButtonElement>('[aria-label^="Move block up"]');
    const down = target.querySelector<HTMLButtonElement>('[aria-label^="Move block down"]');
    expect(up).not.toBeNull();
    expect(down).not.toBeNull();
    expect(up?.disabled).toBe(true);
    expect(down?.disabled).toBe(true);
    expect(up?.title).toBe('Save or discard changes first');
    expect(down?.title).toBe('Save or discard changes first');
  });
});
