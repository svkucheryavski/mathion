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
    const lis = target.querySelectorAll('section.block > ul > li');
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
    const ul = target.querySelector('section.block > ul') as HTMLUListElement;
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
    const ul = target.querySelector('section.block > ul') as HTMLUListElement;
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
    const lis = target.querySelectorAll('section.block > ul > li');
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
});
