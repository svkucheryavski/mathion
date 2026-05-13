import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AccordionHeader from '../components/editor/AccordionHeader.svelte';

// Mount-based regression test for the published-version smoke pass:
// on a non-editable version (state=published/archived, where
// canEditStructure is false), the reorder ↑/↓ buttons must not render.
// Rationale — matches the old BlockEditPage behavior (the buttons were
// wrapped in `{#if perms.canEditStructure}`) and the current ItemRow
// behavior (`{#if canStructure}` wraps the up/down). Without this gate,
// the raw native <button disabled> elements in AccordionHeader look
// identical to enabled ones (no `:disabled` CSS rule), so the user clicks
// and nothing happens — the symptom that surfaced in smoke item 1–28d.
//
// Why `mount()` here vs. the `$effect.root()` pattern in the rest of the
// test suite (see observeIsDirty.svelte.ts): we need DOM assertions
// (querySelector for buttons), so we render the component into a real
// jsdom container. `$effect.root()` is the right tool when verifying
// pure reactive logic; this is a presentational-output test, hence
// mount(). Cleanup unmounts the component and clears document.body —
// AccordionHeader has no $effect / subscription / async state, so no
// further teardown is required; the same pattern won't survive if a
// future change adds an internal $effect, in which case the test
// helper should also dispose an $effect.root.

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
      index: 1,
      expanded: false,
      dirty: false,
      busy: false,
      canStructure: true,
      canReorderUp: false,
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
  it('hides reorder buttons entirely when canStructure is false', () => {
    const target = mountHeader({
      canStructure: false,
      canReorderUp: false,
      canReorderDown: false,
    });
    // Toggle remains so the user can still expand/read the row.
    expect(target.querySelector('#h1')).not.toBeNull();
    // Reorder controls must not be present in the DOM at all.
    expect(target.querySelector('[aria-label^="Move block up"]')).toBeNull();
    expect(target.querySelector('[aria-label^="Move block down"]')).toBeNull();
  });

  it('renders reorder buttons when canStructure is true', () => {
    const target = mountHeader({
      canStructure: true,
      canReorderUp: false,
      canReorderDown: true,
    });
    expect(target.querySelector('[aria-label^="Move block up"]')).not.toBeNull();
    expect(target.querySelector('[aria-label^="Move block down"]')).not.toBeNull();
  });

  it('keeps boundary disabled state when canStructure is true and at first row', () => {
    const target = mountHeader({
      canStructure: true,
      canReorderUp: false,   // first row — nothing above to swap with
      canReorderDown: true,
    });
    const up = target.querySelector<HTMLButtonElement>('[aria-label^="Move block up"]');
    const down = target.querySelector<HTMLButtonElement>('[aria-label^="Move block down"]');
    expect(up?.disabled).toBe(true);
    expect(down?.disabled).toBe(false);
  });
});
