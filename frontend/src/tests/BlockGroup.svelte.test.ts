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
      props: { n: 1,
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
      props: { n: 1,
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
      props: { n: 1,
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
      props: { n: 1,
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
      props: { n: 1,
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
      props: { n: 1, courseSlug: 'course-a', block: { ...BASE_BLOCK, ...over }, state: BASE_STATE, mpByBlockId: {} },
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
    // the button form is editor/AccordionHeader.svelte:67-82.
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
    // ...and still IN the accessibility tree. `aria-hidden="true"` here — the
    // copy-paste slip of the chevron's own attribute two lines down in the
    // template — removes the control from that tree entirely (Chrome honours it:
    // the heading measures empty and the button is gone), so a screen-reader user
    // cannot discover or operate the accordion at all. It passed every lane
    // before this line: 11/11 tests, check clean, gate ALL PASS, because the
    // markup signature records tag:class and ARIA attributes are invisible to it.
    expect(btn.getAttribute('aria-hidden')).toBeNull();
    // EXACTLY one — for the branches THIS fixture renders. `role` is invisible
    // to the gate's markup signature (which records tag:class) and
    // `querySelector` takes the first match, so a second `role="region"` passed
    // BOTH lanes while taking the panel's `border-top` separator and adding an
    // unnamed second landmark; reproduced by mutation on the <ul>. `mountBlock`
    // does not render the mini-project <li>, so that branch is covered by the
    // every-branch test below — a separate mount because `mountBlock` hardcodes
    // `mpByBlockId: {}`. (The `.info` branch is gone: Slice-5c D7.)
    expect(target.querySelectorAll('[role="region"]')).toHaveLength(1);
    // The old glyph span is gone with the chevron that replaced it.
    expect(target.querySelector('.toggle')).toBeNull();
  });

  it('renders exactly one role="region" with every panel branch present', () => {
    // The assertion above runs against `mountBlock`, whose fixture has
    // `mpByBlockId: {}` — so the mini-project <li> is not in the DOM at that
    // moment, and `role="region"` on it would pass unseen (the same hole was
    // reproduced by mutation on the since-removed `.info` div: 10/10 tests,
    // gate ALL PASS). This mount renders every branch the panel still has.
    //
    // The presence assertions are load-bearing, not decoration: without them a
    // fixture change that stopped rendering a branch would silently return this
    // test to the hole it exists to close, and it would still pass. Slice-5c D7
    // removed the `.info` branch: the fixture still sets info_html, and the test
    // now pins that it stays unrendered.
    component = mount(BlockGroup, {
      target,
      props: { n: 1,
        courseSlug: 'course-a',
        block: { ...BASE_BLOCK, info_html: '<p>BLOCK-INFO-MARKER</p>' },
        state: BASE_STATE,
        mpByBlockId: { [String(BASE_BLOCK.id)]: BASE_MP },
      },
    });
    flushSync();
    // Slice-5c D7: block info is never shown, even when info_html is set.
    expect(target.querySelector('.info')).toBeNull();
    expect(target.textContent).not.toContain('BLOCK-INFO-MARKER');
    expect(target.querySelector('.row-mp')).not.toBeNull();
    expect(target.querySelectorAll('section.block > [role="region"] > ul > li')).toHaveLength(3);
    expect(target.querySelectorAll('[role="region"]')).toHaveLength(1);
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

  it('takes its open state from the `expanded` prop and still toggles itself', () => {
    // Collapse/expand all (user, 2026-10-08): CourseView owns which blocks are
    // open (the current block on load) and binds `expanded`. Unbound, the block
    // starts open as before.
    component = mount(BlockGroup, {
      target,
      props: { n: 1, courseSlug: 'course-a', block: BASE_BLOCK, state: BASE_STATE, mpByBlockId: {}, expanded: false },
    });
    flushSync();
    const btn = target.querySelector('header h2 button.acc') as HTMLButtonElement;
    const panel = target.querySelector('[role="region"]') as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    flushSync();
    expect(panel.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
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

  it('never renders block info, even when info_html is set (Slice-5c D7)', () => {
    const { panel } = mountBlock({ info_html: '<p>Read this first.</p>' });
    expect(panel.querySelector('.info')).toBeNull();
    expect(panel.textContent).not.toContain('Read this first.');
  });

  it('numbers the block "1." like the admin editor — a light, aria-hidden ordinal; no B-badge', () => {
    // User, 2026-10-08: "B1" was the last structure code a student saw (the
    // S-codes went first). The visible ordinal is aria-hidden; the button's
    // aria-label states "1. Title" in words (the blocks are sibling sections,
    // not a list, so nothing else would announce the number).
    const { btn } = mountBlock();
    expect(btn.querySelector('.badge')).toBeNull();
    const num = btn.querySelector('.num') as HTMLElement;
    expect(num.textContent).toBe('1.');
    expect(num.getAttribute('aria-hidden')).toBe('true');
    expect((btn.querySelector('.acc-title') as HTMLElement).textContent).toBe('Block 42');
    expect(target.textContent).not.toContain('B1');
  });

  // Items for the block-total tests: sequence 101 holds items 1 (page) and
  // 2 (quiz), sequence 102 holds item 3 (quiz). State in the literal API shape.
  const it3 = (id: number, type: 'static_page' | 'quiz') =>
    ({ id, title: `I${id}`, slug: `i${id}`, order: id, type }) as SequenceContent['items'][number];
  const totalsBlock = (): BlockContent => ({
    ...BASE_BLOCK,
    sequences: [
      { ...makeSequence(101, 1), items: [it3(1, 'static_page'), it3(2, 'quiz')] },
      { ...makeSequence(102, 2), items: [it3(3, 'quiz')] },
    ],
  });
  const entry = (covered: boolean, score: [number, number] | null) => ({
    is_covered: covered, time_spent: 0, last_visited_at: null, attempt_count: score ? 1 : 0,
    max_attempts: 3, last_score: score ? { correct: score[0], total: score[1] } : null, last_answers: null,
  });
  const totalsState: VersionState = {
    version_id: 1,
    items: { '1': entry(true, null), '2': entry(true, [3, 4]), '3': entry(false, [1, 4]) },
  };
  function mountTotals() {
    component = mount(BlockGroup, {
      target,
      props: { n: 1, courseSlug: 'course-a', block: totalsBlock(), state: totalsState, mpByBlockId: {} },
    });
    flushSync();
    return target.querySelector('header h2 button.acc') as HTMLButtonElement;
  }

  it('shows the BLOCK totals in the header: items over every sequence, quiz score over the quizzes tried', () => {
    // 2 of 3 items → 66%; quizzes (3 + 1) / (4 + 4) = 50%.
    const btn = mountTotals();
    const kids = Array.from(btn.children).map((e) => e.getAttribute('class')!.split(' ')[0]);
    expect(kids).toEqual(['num', 'acc-title', 'progress', 'quiz-chip', 'chev']);
    expect((btn.querySelector('.progress .pct') as HTMLElement).textContent).toBe('66%');
    expect((btn.querySelector('.quiz-chip') as HTMLElement).textContent!.trim()).toBe('Quiz 50%');
    // On the tinted strip the chip takes the light fill.
    expect(btn.querySelector('.quiz-chip')!.classList.contains('on-strip')).toBe(true);
  });

  it('states the block totals in words as the button name, for screen readers', () => {
    // The bar and chip are aria-hidden, so the name carries the phrase. An
    // aria-label (SequenceLink's form), not a visually hidden span: Chrome
    // blockifies an absolutely positioned span and announced "Title , 2 of 3".
    // It starts with the visible title, so voice control still matches it.
    const btn = mountTotals();
    // The "1." is aria-hidden as a visual mark but IS in the name (Opus lane):
    // the blocks are sibling sections, not a list, so nothing else states it,
    // and the player crumb announces "1. Title" too.
    expect(btn.getAttribute('aria-label')).toBe('1. Block 42, 2 of 3 items completed, quiz score 50%');
    expect(btn.querySelector('.sr-only')).toBeNull();
  });

  it('keeps the totals in the header when the block is collapsed', () => {
    const btn = mountTotals();
    btn.click();
    flushSync();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect((btn.querySelector('.progress .pct') as HTMLElement).textContent).toBe('66%');
    expect((btn.querySelector('.quiz-chip') as HTMLElement).textContent!.trim()).toBe('Quiz 50%');
  });
});
