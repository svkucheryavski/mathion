import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import UnsupportedItem from '../components/items/UnsupportedItem.svelte';

let cleanup: (() => void) | null = null;
function render() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // Mounted with NO props on purpose: T5 removes the `type` prop entirely.
  // It was the component's only one, but the `<script lang="ts">` block STAYS
  // (empty) — deleting it leaves the component untyped and every importer
  // resolves it as implicit `any`, taking `npm run check` from 0 to 2 errors.
  // If a required prop were reintroduced this mount is what would surface it.
  const cmp = mount(UnsupportedItem, { target, props: {} });
  cleanup = () => unmount(cmp);
  flushSync();
  return target;
}
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('renders type-neutral copy that leaks no raw type identifier', () => {
  const target = render();
  const p = target.querySelector('.unsupported p');
  expect(p).not.toBeNull();

  const text = p!.textContent ?? '';
  expect(text).toContain("isn't available");
  // visual-spec:230 requires human-readable type names ("single choice", not
  // single_choice). The fix is to drop the identifier rather than humanise it,
  // so BOTH the raw slug and the parenthesis that wrapped it must be gone —
  // asserting only the slug would still pass on `This item type ("video") …`.
  expect(text).not.toContain('mini_project');
  expect(text).not.toContain('(');
});

it('renders a plain notice box, not an article-rhythm surface', () => {
  // Why the article rule does not apply: no <article> and no <h2>, which is
  // exactly what this asserts. The RETAINED `padding: var(--space-3)` is NOT
  // checked here and the title no longer implies it is — jsdom gets no
  // component CSS (vite.config.ts sets no `css: true`), so any assertion on it
  // would be vacuous. It is pinned in the built CSS instead, by the slice's
  // per-task dist gate (spec:197, T5 targets), together with the dashed border.
  const target = render();
  const box = target.querySelector('.unsupported');
  expect(box).not.toBeNull();
  expect(box!.tagName).toBe('DIV');
  expect(target.querySelector('article')).toBeNull();
  expect(target.querySelector('h2')).toBeNull();
});
