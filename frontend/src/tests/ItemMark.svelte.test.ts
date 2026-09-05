import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemMark from '../components/course/ItemMark.svelte';
import type { Item, ItemMarkState } from '../lib/types';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

/** `state` is genuinely optional here — omitting it is what exercises D5's
 *  `state = 'not-yet'` default, which the MiniProjectLink flag (T7) relies on. */
function render(type: Item['type'], state?: ItemMarkState) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const props = state === undefined ? { type } : { type, state };
  component = mount(ItemMark, { target: host, props });
  flushSync();
  return host.querySelector('.item-mark') as HTMLSpanElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

describe('ItemMark', () => {
  const types: Item['type'][] = [
    'static_page', 'video', 'quiz', 'interactive_app', 'mini_project',
  ];

  it('is a non-interactive <span>, hidden from AT, with no text node', () => {
    // D5: presentational only. The chain of these in SequenceLink (T7) carries
    // NO accessible name — completion reaches AT through the sibling mono
    // {covered}/{total} count instead — so a text node here would leak a
    // second, unlabelled reading of the same fact.
    const mark = render('quiz', 'covered');
    expect(mark).not.toBeNull();
    expect(mark.tagName).toBe('SPAN');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect((mark.textContent ?? '').trim()).toBe('');
    // Presentational: it must not be focusable or a control.
    expect(host.querySelector('button')).toBeNull();
    expect(mark.hasAttribute('tabindex')).toBe(false);
  });

  for (const type of types) {
    it(`renders an aria-hidden SVG mark for ${type}`, () => {
      const svg = render(type, 'not-yet').querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
    });
  }

  it('renders a DISTINCT mark for every item type (no shared SVG)', () => {
    // Full-set distinctness, not a two-type spot check: a pairwise assertion
    // would let quiz / interactive_app / mini_project collapse onto one mark.
    const marks = types.map((type) => {
      const svg = render(type, 'not-yet').querySelector('svg')!.innerHTML;
      unmount(component!); component = null; host.parentNode?.removeChild(host);
      return svg;
    });
    expect(new Set(marks).size).toBe(types.length);
  });

  for (const state of ['covered', 'current', 'not-yet'] as const) {
    it(`applies the ${state} state class to the root`, () => {
      const mark = render('quiz', state);
      expect(mark.classList.contains(state)).toBe(true);
      // Exactly one state class — the CSS state rules are mutually exclusive
      // overrides of the base box, so two at once is a cascade coin-flip.
      const others = (['covered', 'current', 'not-yet'] as const).filter((s) => s !== state);
      for (const other of others) expect(mark.classList.contains(other)).toBe(false);
    });
  }

  it('defaults to not-yet when `state` is omitted', () => {
    // D5 pins the default so a consumer with no state to give — MiniProjectLink's
    // single flag (T7) — need not supply one. Asserted by OMITTING the prop, not
    // by passing 'not-yet', which would prove nothing about the default.
    const mark = render('mini_project');
    expect(mark.classList.contains('not-yet')).toBe(true);
    expect(mark.classList.contains('covered')).toBe(false);
    expect(mark.classList.contains('current')).toBe(false);
  });
});
