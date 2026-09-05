import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SequenceLink from '../components/course/SequenceLink.svelte';
import type { Item, SequenceContent, VersionState } from '../lib/types';

// Per the codebase memory rule: component tests use mount/unmount/flushSync
// from `svelte`, NOT @testing-library/svelte.

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function item(id: number, type: Item['type'] = 'static_page'): Item {
  return { id, title: `Item ${id}`, slug: `i${id}`, order: id, type } as Item;
}

function sequence(over: Partial<SequenceContent> = {}): SequenceContent {
  return { id: 9, title: 'Determinants', slug: 'det', order: 3, items: [item(1), item(2), item(3)], ...over };
}

/** `state.items` is keyed by item id AS A STRING (types.ts:136-139). */
function vstate(covered: number[]): VersionState {
  const items: VersionState['items'] = {};
  for (const id of [1, 2, 3, 4]) {
    items[String(id)] = {
      is_covered: covered.includes(id),
      time_spent_seconds: 0,
      last_visited_at: null,
      last_answers: null,
    } as VersionState['items'][string];
  }
  return { version_id: 1, items };
}

type Props = { courseSlug: string; sequence: SequenceContent; state: VersionState };
let props: Props;

function render(over: Partial<Props> = {}): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const reactive = $state<Props>({
    courseSlug: 'linear-algebra',
    sequence: sequence(),
    state: vstate([1, 2]),
    ...over,
  });
  props = reactive;
  component = mount(SequenceLink, { target: host, props: reactive });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

describe('SequenceLink', () => {
  it('splits the combined "S{order}. {title}" into a mono badge and a title', () => {
    // The row used to render one text node, `S3. Determinants`. Ref 1573 shows
    // the order as a code badge, so the markup splits — and the badge carries NO
    // trailing period, which is the detail a careless re-split would keep.
    const root = render();
    const badge = root.querySelector('.badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('S3');
    // The mono face comes from the GLOBAL `.mono` utility (base.css:10), not a
    // scoped font-family — jsdom cannot see scoped CSS, so the class IS the pin.
    expect(badge.classList.contains('mono')).toBe(true);
    const title = root.querySelector('.row-title') as HTMLElement;
    expect(title).not.toBeNull();
    expect(title.textContent).toBe('Determinants');
    // ...and the old combined form is gone in both directions.
    expect(root.textContent).not.toContain('S3. Determinants');
  });

  it('removes the ✓ with NO replacement mark — completion reads from the chain', () => {
    // A fully-covered sequence used to append a green ✓. Completion now reads
    // visually from an all-covered chain and, for AT, from the row's
    // aria-label; a replacement glyph would be a third, redundant signal.
    const root = render({ state: vstate([1, 2, 3]) });
    expect(root.textContent).not.toContain('✓');
    expect(root.querySelector('.check')).toBeNull();
    // The count still says so — the sighted reading of what the aria-label
    // carries in words.
    expect((root.querySelector('.count') as HTMLElement).textContent).toBe('3/3');
  });

  it('renders an aria-hidden ItemMark chain, one mark per item, in the right states', () => {
    const root = render();                       // items 1,2 covered of 1,2,3
    const chain = root.querySelector('.chain') as HTMLElement;
    expect(chain).not.toBeNull();
    // The whole chain is hidden from AT (Constraint 3): each mark is already
    // aria-hidden, and this wrapper leaves the row's aria-label as the SOLE
    // completion signal assistive tech receives.
    expect(chain.getAttribute('aria-hidden')).toBe('true');
    const marks = Array.from(chain.querySelectorAll('.item-mark'));
    expect(marks).toHaveLength(3);
    expect(marks.map((m) => (m.classList.contains('covered') ? 'covered' : 'not-yet')))
      .toEqual(['covered', 'covered', 'not-yet']);
    // `current` is a player-only state; a course-landing chain never shows it.
    expect(chain.querySelectorAll('.item-mark.current')).toHaveLength(0);
    // Non-interactive: no control anywhere in the row's right-hand side.
    expect(chain.querySelector('button, a, input')).toBeNull();
  });

  it('feeds each item its OWN type through to the mark it draws', () => {
    // Both review lanes independently found this hole: hardcoding
    // `type="static_page"` (or any single type) in the chain left every
    // assertion green while every mark in the app drew the wrong glyph. Chain
    // LENGTH and STATE were pinned; the type-to-glyph mapping — the whole
    // reason the chain takes a per-item type — was not. jsdom cannot see CSS
    // but it CAN see inline SVG, so the mark's child-tag signature is the pin.
    const root = render({
      sequence: sequence({
        items: [item(1, 'static_page'), item(2, 'video'), item(3, 'quiz')],
      }),
    });
    const marks = Array.from(root.querySelectorAll('.chain .item-mark'));
    const shape = (m: Element) => Array.from(m.querySelector('svg')!.children).map((c) => c.tagName);
    expect(shape(marks[0])).toEqual(['line', 'line', 'line']);   // page: three rules
    expect(shape(marks[1])).toEqual(['polygon']);                // video: play triangle
    expect(shape(marks[2])).toEqual(['polyline']);               // quiz: check
  });

  it('renders exactly badge, title, chain, count — in that order, with nothing appended', () => {
    // Two escapes at once. (a) The count must sit at the row's RIGHT edge
    // (mathion-visual-spec.md:250-251); swapping it before the chain put the
    // chain there instead, with the gate green — section (j) grades CSS and
    // cannot see markup order. (b) The `✓` removal was asserted by rejecting
    // the `✓` character and `.check`, so ANY other replacement glyph — a `★`
    // in an {#if covered === total} — sailed through. An exact child schema
    // closes both, and does so for the fully-covered case where a completion
    // mark would be tempting to re-add.
    const root = render({ state: vstate([1, 2, 3]) });
    const kids = Array.from((root.querySelector('a.row') as HTMLElement).children);
    expect(kids.map((e) => e.className.split(' ')[0])).toEqual(['badge', 'row-title', 'chain', 'count']);
  });

  it('renders the count as exact "{covered}/{total}" text with the mono class', () => {
    const root = render();
    const count = root.querySelector('.count') as HTMLElement;
    expect(count).not.toBeNull();
    // Exact text: `formatProgress` produced a spaced/worded form, and the
    // pinned shape is the bare ratio. Asserting textContent (not a substring)
    // is what catches a stray space or a re-introduced helper.
    expect(count.textContent).toBe('2/3');
    expect(count.classList.contains('mono')).toBe(true);
  });

  it('names the row for assistive tech instead of leaving it to the contents', () => {
    // The chain is aria-hidden, so before this the link's computed name was its
    // remaining text — "S3 Determinants 2/3", a bare token plus a ratio a screen
    // reader renders as "two slash three". The label states the same three facts
    // in words, and pinning the WHOLE string is what catches a silent drop of
    // any one of them (order, title, or progress).
    const a = render().querySelector('a.row') as HTMLAnchorElement;
    expect(a.getAttribute('aria-label')).toBe('Sequence S3: Determinants, 2 of 3 items completed');
  });

  it('recomputes the aria-label from props, and says "item" for exactly one item', () => {
    // A label built as a plain `const` would freeze at mount exactly as `total`,
    // `covered` and `href` did before they became `$derived` — and it would do so
    // invisibly, since nothing on screen changes. Coverage alone must move it,
    // and so must a whole-sequence swap.
    const root = render();
    const a = root.querySelector('a.row') as HTMLAnchorElement;

    props.state = vstate([1, 2, 3, 4]);
    flushSync();
    expect(a.getAttribute('aria-label')).toBe('Sequence S3: Determinants, 3 of 3 items completed');

    props.sequence = sequence({ id: 12, order: 4, title: 'Eigenvalues', items: [item(4)] });
    flushSync();
    // Singular: "1 of 1 items completed" is what a template with no plural
    // branch would say.
    expect(a.getAttribute('aria-label')).toBe('Sequence S4: Eigenvalues, 1 of 1 item completed');

    // ...and EXACTLY one. With only totals 3 and 1 asserted, `total === 1`
    // relaxed to `total <= 1` passed the whole file (codex, T7 round 2) and
    // would have shipped "0 of 0 item completed" on an empty sequence. Zero is
    // plural in English, so this is the assertion that separates the two.
    props.sequence = sequence({ items: [] });
    flushSync();
    expect(a.getAttribute('aria-label')).toBe('Sequence S3: Determinants, 0 of 0 items completed');
    expect(root.querySelectorAll('.chain .item-mark')).toHaveLength(0);
  });

  it('points at the sequence route', () => {
    const a = render().querySelector('a.row') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe('/courses/linear-algebra/seq/9');
  });

  it('recomputes href, total and covered when its props change', () => {
    // `total` and `href` were plain `const`s reading `$props()` at init, which
    // captured only the initial value (three `state_referenced_locally`
    // warnings). A parent swapping the sequence — BlockGroup re-keying its
    // {#each} — would have kept the old count and the old link.
    const root = render();
    expect((root.querySelector('.count') as HTMLElement).textContent).toBe('2/3');

    props.sequence = sequence({ id: 12, order: 4, title: 'Eigenvalues', items: [item(1), item(4)] });
    props.courseSlug = 'algebra-2';
    flushSync();

    expect((root.querySelector('.badge') as HTMLElement).textContent).toBe('S4');
    expect((root.querySelector('.row-title') as HTMLElement).textContent).toBe('Eigenvalues');
    expect((root.querySelector('.count') as HTMLElement).textContent).toBe('1/2');
    expect(root.querySelectorAll('.chain .item-mark')).toHaveLength(2);
    // One covered OF TWO — the case that separates `total === 1` from
    // `covered === 1` in the label's plural branch (codex, T7 round 3). The
    // four cases asserted above are 2/3, 3/3, 1/1 and 0/0, on every one of
    // which the two predicates agree, so the wrong one passed the whole file
    // and would have shipped "1 of 2 item completed".
    expect((root.querySelector('a.row') as HTMLAnchorElement).getAttribute('aria-label'))
      .toBe('Sequence S4: Eigenvalues, 1 of 2 items completed');
    expect((root.querySelector('a.row') as HTMLAnchorElement).getAttribute('href'))
      .toBe('/courses/algebra-2/seq/12');

    // Coverage alone must also flow through.
    props.state = vstate([1, 4]);
    flushSync();
    expect((root.querySelector('.count') as HTMLElement).textContent).toBe('2/2');
  });

  it('counts an item with no state entry as not covered', () => {
    // A sequence item the student has never opened has no `state.items` key at
    // all; the optional chain must read that as not-covered rather than throw.
    const root = render({ state: { version_id: 1, items: {} } });
    expect((root.querySelector('.count') as HTMLElement).textContent).toBe('0/3');
    expect(root.querySelectorAll('.chain .item-mark.covered')).toHaveLength(0);
  });
});
