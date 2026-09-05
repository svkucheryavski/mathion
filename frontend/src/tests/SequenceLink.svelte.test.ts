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
    // visually from an all-covered chain and, for AT, from the mono count; a
    // replacement glyph would be a third, redundant signal.
    const root = render({ state: vstate([1, 2, 3]) });
    expect(root.textContent).not.toContain('✓');
    expect(root.querySelector('.check')).toBeNull();
    // The count still says so, and it is the AT-visible one.
    expect((root.querySelector('.count') as HTMLElement).textContent).toBe('3/3');
  });

  it('renders an aria-hidden ItemMark chain, one mark per item, in the right states', () => {
    const root = render();                       // items 1,2 covered of 1,2,3
    const chain = root.querySelector('.chain') as HTMLElement;
    expect(chain).not.toBeNull();
    // The whole chain is hidden from AT (Constraint 3): each mark is already
    // aria-hidden, and this wrapper makes the mono count the SOLE completion
    // signal assistive tech receives.
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
