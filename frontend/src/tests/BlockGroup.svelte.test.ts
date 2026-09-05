import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import BlockGroup from '../components/course/BlockGroup.svelte';
import type {
  BlockContent,
  SequenceContent,
  VersionState,
  StudentMiniProjectListItem,
} from '../lib/types';

// Per the codebase memory rule: component tests use mount/unmount/flushSync
// from `svelte`, NOT @testing-library/svelte.

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) unmount(component);
  document.body.removeChild(target);
});

// ---- BASE fixtures ----

function makeSequence(id: number, order: number): SequenceContent {
  return {
    id,
    title: `Sequence ${order}`,
    slug: `seq-${id}`,
    order,
    items: [],
  };
}

const BASE_BLOCK: BlockContent = {
  id: 42,
  title: 'Block 42',
  slug: 'block-42',
  order: 1,
  info: '',
  info_html: '',
  sequences: [makeSequence(101, 1), makeSequence(102, 2)],
};

const BASE_STATE: VersionState = {
  version_id: 1,
  items: {},
};

const BASE_MP: StudentMiniProjectListItem = {
  mp_id: 7,
  block_id: 42,
  block_slug: 'block-42',
  block_order: 1,
  block_title: 'Block 42',
  hard_deadline: null,
  soft_deadline: null,
  resubmission_deadline: null,
  latest_status: 'not_submitted',
};

describe('BlockGroup', () => {
  it('renders sequence <li>s and NO MP <li> when mpByBlockId is empty (spec §8 case 1)', () => {
    component = mount(BlockGroup, {
      target,
      props: {
        courseSlug: 'course-a',
        block: BASE_BLOCK,
        state: BASE_STATE,
        mpByBlockId: {},
      },
    });
    flushSync();
    const lis = target.querySelectorAll('section.block > [role="region"] > ul > li');
    expect(lis.length).toBe(2);
    expect(target.querySelector('.row-mp')).toBeNull();
  });

  it('renders MP <li> AFTER sequence <li>s when mpByBlockId has the block (spec §8 case 2, DOM order)', () => {
    component = mount(BlockGroup, {
      target,
      props: {
        courseSlug: 'course-a',
        block: BASE_BLOCK,
        state: BASE_STATE,
        mpByBlockId: { '42': BASE_MP },
      },
    });
    flushSync();
    const ul = target.querySelector('section.block > [role="region"] > ul') as HTMLUListElement;
    expect(ul).not.toBeNull();
    expect(ul.children.length).toBe(3);
    // First two <li>s are sequences (no .row-mp inside); last <li> contains the MP link.
    expect(ul.children[0].querySelector('.row-mp')).toBeNull();
    expect(ul.children[1].querySelector('.row-mp')).toBeNull();
    expect(ul.children[2].querySelector('.row-mp')).not.toBeNull();
  });

  it('renders only the MP <li> when block has no sequences (spec §8 case 3)', () => {
    component = mount(BlockGroup, {
      target,
      props: {
        courseSlug: 'course-a',
        block: { ...BASE_BLOCK, sequences: [] },
        state: BASE_STATE,
        mpByBlockId: { '42': BASE_MP },
      },
    });
    flushSync();
    const ul = target.querySelector('section.block > [role="region"] > ul') as HTMLUListElement;
    expect(ul).not.toBeNull();
    expect(ul.children.length).toBe(1);
    expect(ul.children[0].querySelector('.row-mp')).not.toBeNull();
  });

  it('renders no MP <li> when mpByBlockId prop is omitted entirely (spec §8 case 4)', () => {
    component = mount(BlockGroup, {
      target,
      props: {
        courseSlug: 'course-a',
        block: BASE_BLOCK,
        state: BASE_STATE,
      },
    });
    flushSync();
    const lis = target.querySelectorAll('section.block > [role="region"] > ul > li');
    expect(lis.length).toBe(2);
    expect(target.querySelector('.row-mp')).toBeNull();
  });

  it('looks up mpByBlockId by String(block.id) — fixture uses string key "42" for numeric id 42 (spec §8 case 5)', () => {
    // The Record type is `Record<string, ...>`, so the fixture key MUST be a
    // string literal. This proves the lookup applies `String(block.id)` —
    // otherwise the numeric block.id would fail to index into a string-keyed
    // Record (no implicit coercion in strict TS / runtime object keys).
    const mpByBlockId: Record<string, StudentMiniProjectListItem> = { '42': BASE_MP };
    component = mount(BlockGroup, {
      target,
      props: {
        courseSlug: 'course-a',
        block: BASE_BLOCK, // block.id = 42 (number)
        state: BASE_STATE,
        mpByBlockId,
      },
    });
    flushSync();
    const link = target.querySelector('.row-mp');
    expect(link).not.toBeNull();
  });

  // ---- T8a: the accordion contract ----
  //
  // Entirely new coverage: this file had no expand/collapse test at all, which is
  // why the "adjust selectors only" green-list rule holds for the four cases above
  // — there was no collapse assertion to weaken.

  function mountBlock(over: Partial<BlockContent> = {}) {
    component = mount(BlockGroup, {
      target,
      props: { courseSlug: 'course-a', block: { ...BASE_BLOCK, ...over }, state: BASE_STATE, mpByBlockId: {} },
    });
    flushSync();
    return {
      btn: target.querySelector('header h2 button.acc') as HTMLButtonElement,
      panel: target.querySelector('[role="region"]') as HTMLElement,
    };
  }

  it('gives the header a real <button> carrying the accordion ARIA contract', () => {
    // The header was a <div onclick>: not focusable, not keyboard-operable, and
    // the source of the two a11y warnings this task removes. The precedent for
    // the button form is editor/AccordionHeader.svelte:59-71.
    const { btn, panel } = mountBlock();
    expect(btn).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(btn.id).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // aria-controls must POINT at the panel, and the panel must point back.
    expect(btn.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(btn.id);
    // Keyboard-reachable is the whole point of the change. `tabindex="-1"` would
    // destroy it while leaving every other assertion here green — btn.click()
    // still fires, the selector still matches, and no CSS moves.
    expect(btn.tabIndex).toBe(0);
    // EXACTLY one. `role` is invisible to the gate's markup signature (which
    // records tag:class) and `querySelector` takes the first match, so a second
    // `role="region"` anywhere in this template passed BOTH lanes — while taking
    // the panel's `border-top` separator and adding an unnamed second landmark.
    // Reproduced by mutation on the <ul> before this line existed.
    expect(target.querySelectorAll('[role="region"]')).toHaveLength(1);
    // The old glyph span is gone with the chevron that replaced it.
    expect(target.querySelector('.toggle')).toBeNull();
  });

  it('keeps the panel AND its contents in the DOM when collapsed, gating only on hidden', () => {
    // Reading B, pinned: the outer {#if expanded} is dropped entirely. A
    // DOM-absence check would pass the wrong implementation, so the collapsed
    // assertion is the `hidden` PROPERTY — and the id must never dangle, which is
    // what keeps the aria-controls contract true in both states.
    const { btn, panel } = mountBlock();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('ul')).not.toBeNull();

    btn.click();
    flushSync();

    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector('[role="region"]')).toBe(panel);   // same node, not re-created
    expect(panel.hidden).toBe(true);
    expect(panel.querySelector('ul')).not.toBeNull();              // contents ALWAYS rendered
    expect(panel.querySelectorAll('li').length).toBe(2);
    expect(btn.getAttribute('aria-controls')).toBe(panel.id);      // still matches, collapsed

    btn.click();
    flushSync();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
  });

  it('rotates the chevron exactly when the header reads collapsed', () => {
    // `{expanded ? "▾" : "▸"}` encoded the state as DIRECTION, so a static SVG
    // would drop the only VISIBLE collapsed cue and leave just aria-expanded.
    // The pinned form is one down-chevron rotated by a class, so the assertion is
    // the iff: `.collapsed` present exactly when aria-expanded is "false".
    const { btn } = mountBlock();
    const chev = btn.querySelector('svg.chev') as SVGElement;
    expect(chev).not.toBeNull();
    // The whole Constraint-3 SVG convention, pinned here because nothing else
    // can see it: the gate grades CSS, and its markup scanner records
    // tag:class signatures, so every one of these attributes is invisible to
    // both. `fill="none"` is the one that matters most — a <polyline> has an
    // implicit closing segment for fill purposes and SVG initial fill is BLACK,
    // so deleting it (a very natural tidy-up on a stroke-only shape) turns the
    // hairline into a solid black triangle that `color: var(--muted)` cannot
    // correct, since fill does not resolve to currentColor.
    expect(chev.getAttribute('aria-hidden')).toBe('true');
    expect(chev.getAttribute('fill')).toBe('none');
    expect(chev.getAttribute('stroke')).toBe('currentColor');
    expect(chev.getAttribute('stroke-width')).toBe('1.6');
    // viewBox and the round caps/joins are part of that same convention and were
    // NOT pinned in the first pass, though the comment above claimed the whole of
    // it. `viewBox="0 0 24 24"` reads as a house-style tidy-up and silently breaks
    // the glyph: the points live in 16-unit space, so in a 24-unit box the chevron
    // draws at two-thirds scale, tucked up and left of centre, with a
    // proportionally thinner stroke.
    expect(chev.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(chev.getAttribute('stroke-linecap')).toBe('round');
    expect(chev.getAttribute('stroke-linejoin')).toBe('round');
    // 13px, inside Constraint 3's ~11-14px band. The glyph carrying these points
    // is 13x13 at ref 1559 (the "Collapse" control) AND as the last SVG on BOTH
    // refs the spec cites, 1568 and 1576. (This shipped at 16 and no lane caught
    // it.)
    expect(chev.getAttribute('width')).toBe('13');
    expect(chev.getAttribute('height')).toBe('13');
    expect(chev.querySelector('polyline')!.getAttribute('points')).toBe('4.6,6.6 8,10 11.4,6.6');
    const agree = () =>
      chev.classList.contains('collapsed') === (btn.getAttribute('aria-expanded') === 'false');
    expect(chev.classList.contains('collapsed')).toBe(false);
    expect(agree()).toBe(true);
    btn.click();
    flushSync();
    expect(chev.classList.contains('collapsed')).toBe(true);
    expect(agree()).toBe(true);
    btn.click();
    flushSync();
    expect(agree()).toBe(true);
  });

  it('renders .info only when block.info_html is non-empty', () => {
    // Only the OUTER {#if expanded} is dropped; this inner guard is retained.
    // Without it the pinned `.info { padding: 8px 16px }` would draw an empty
    // padded strip above the first row of every block that has no info — and
    // BASE_BLOCK has `info_html: ''`, so the baseline suite would not notice.
    const { panel } = mountBlock();
    expect(panel.querySelector('.info')).toBeNull();
    unmount(component);
    target.innerHTML = '';

    const withInfo = mountBlock({ info_html: '<p>Read this first.</p>' });
    const info = withInfo.panel.querySelector('.info') as HTMLElement;
    expect(info).not.toBeNull();
    expect(info.textContent).toContain('Read this first.');
  });

  it('splits "B{order}. {title}" into a mono badge and a title, with no trailing period', () => {
    // A rendered-copy change: `B1. Block 42` becomes `B1 Block 42`. The badge is
    // ref 1565, the twin of the S-badge SequenceLink renders.
    const { btn } = mountBlock();
    const badge = btn.querySelector('.badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('B1');
    // The mono face comes from the GLOBAL `.mono` utility (base.css:10), which
    // jsdom cannot see as CSS — so the class is the pin.
    expect(badge.classList.contains('mono')).toBe(true);
    // The header carries the badge and the title and NOTHING else: the chevron is
    // an SVG and contributes no text, so any added glyph or restored period shows
    // up here. (The T7 lesson: an element-only check cannot see a text node.)
    expect(btn.textContent!.replace(/\s+/g, ' ').trim()).toBe('B1 Block 42');
    expect(target.textContent).not.toContain('B1.');
  });
});
