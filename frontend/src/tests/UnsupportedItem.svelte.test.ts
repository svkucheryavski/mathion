import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import UnsupportedItem from '../components/items/UnsupportedItem.svelte';

let cleanup: (() => void) | null = null;
function render() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // Mounted with NO props on purpose: T5 removes the `type` prop entirely
  // (it was the component's only one, so the whole <script> block goes).
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

it('keeps the dashed notice box and its own inset padding', () => {
  // The article-rhythm rule does NOT apply here: this component has no
  // <article> and no <h2>, and its padding is the notice box's inset that
  // keeps text off the dashed border (spec §2 UnsupportedItem, retained).
  const target = render();
  const box = target.querySelector('.unsupported');
  expect(box).not.toBeNull();
  expect(box!.tagName).toBe('DIV');
  expect(target.querySelector('article')).toBeNull();
  expect(target.querySelector('h2')).toBeNull();
});
