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
    it(`renders an aria-hidden SVG mark for ${type}, at the pinned geometry`, () => {
      const svg = render(type, 'not-yet').querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      // The <svg> element's OWN attributes are pinned here because nothing else
      // sees them: the geometry table below starts at `svg.children`, and the
      // dist gate sees only CSS. Constraint 3 + D5 fix the 11px size and the
      // 16-unit viewBox, and spec section 4 states the marks are transcribed
      // verbatim at stroke-width 1.6 EXCEPT the quiz check at 1.9 — so the
      // ternary is a real pin, not an incidental detail.
      //
      // Compared as a COMPLETE set (codex-r2-I1): naming individual attributes
      // left `fill`, `stroke-linecap` and `stroke-linejoin` unpinned, and
      // dropping `fill="none"` floods the quiz polyline into a solid blob while
      // every test and the CSS gate stay green.
      const rootAttrs = Object.fromEntries(
        Array.from(svg!.attributes).map((a) => [a.name, a.value]),
      );
      expect(rootAttrs).toEqual({
        width: '11',
        height: '11',
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': type === 'quiz' ? '1.9' : '1.6',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      });
    });
  }

  // Exact per-type geometry, transcribed from the reference "Item types" card
  // (reference-screens.dc.html:1438) and its in-sequence chains (:1039-1040,
  // :2113-2116). The distinctness test below proves only that the five bodies
  // DIFFER — codex-r1-I2 showed that deleting `fill="currentColor"
  // stroke="none"` from the video polygon silently turns the solid play mark
  // into a hollow outline with every test and the CSS gate still green, and that
  // coordinate drift passes just as quietly. The attribute set is compared
  // EXACTLY, so this reds on a dropped override, an added one, or a moved point.
  const MARKS: Record<Item['type'], { tag: string; attrs: Record<string, string> }[]> = {
    static_page: [
      { tag: 'line', attrs: { x1: '3', y1: '4', x2: '13', y2: '4' } },
      { tag: 'line', attrs: { x1: '3', y1: '8', x2: '13', y2: '8' } },
      { tag: 'line', attrs: { x1: '3', y1: '12', x2: '9', y2: '12' } },
    ],
    video: [
      { tag: 'polygon', attrs: { points: '5,3.4 13,8 5,12.6', fill: 'currentColor', stroke: 'none' } },
    ],
    quiz: [
      { tag: 'polyline', attrs: { points: '3,8.6 6.4,12 13,4.6' } },
    ],
    interactive_app: [
      { tag: 'line', attrs: { x1: '4', y1: '2.6', x2: '4', y2: '13.4' } },
      { tag: 'line', attrs: { x1: '8', y1: '2.6', x2: '8', y2: '13.4' } },
      { tag: 'line', attrs: { x1: '12', y1: '2.6', x2: '12', y2: '13.4' } },
      { tag: 'circle', attrs: { cx: '4', cy: '10', r: '1.9', fill: 'currentColor', stroke: 'none' } },
      { tag: 'circle', attrs: { cx: '8', cy: '5.4', r: '1.9', fill: 'currentColor', stroke: 'none' } },
      { tag: 'circle', attrs: { cx: '12', cy: '8.6', r: '1.9', fill: 'currentColor', stroke: 'none' } },
    ],
    mini_project: [
      { tag: 'line', attrs: { x1: '4.2', y1: '2.4', x2: '4.2', y2: '13.6' } },
      { tag: 'polygon', attrs: { points: '4.2,3.2 12.4,5.8 4.2,8.4', fill: 'currentColor', stroke: 'none' } },
    ],
  };

  for (const type of types) {
    it(`draws ${type} at the exact reference geometry`, () => {
      const svg = render(type, 'not-yet').querySelector('svg')!;
      const kids = Array.from(svg.children);
      const want = MARKS[type];
      expect(kids.map((k) => k.tagName)).toEqual(want.map((w) => w.tag));
      kids.forEach((kid, i) => {
        // Compare the WHOLE attribute set, not just the expected keys: a
        // `fill="currentColor"` added to an outline shape is as wrong as one
        // deleted from a solid, and only an exact set catches both directions.
        const got = Object.fromEntries(
          Array.from(kid.attributes).map((a) => [a.name, a.value]),
        );
        expect(got).toEqual(want[i].attrs);
      });
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

  it('carries NO inline style attribute — inline styles bypass the CSS gate', () => {
    // codex-r1-C1: Svelte emits `style="…"` into the JS bundle, not into
    // dist/_app/*.css, so the built-CSS gate is structurally blind to it. An
    // inline 22px bordered box put back on either root restores the double ring
    // with the gate reporting ALL PASS (reproduced). The gate now rejects inline
    // styling in both T6 components; this is the runtime half of that pin.
    for (const state of ['covered', 'current', 'not-yet'] as const) {
      const mark = render('quiz', state);
      expect(mark.hasAttribute('style')).toBe(false);
      unmount(component!); component = null; host.parentNode?.removeChild(host);
    }
  });

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
