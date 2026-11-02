import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// Stub only loadCourse (skip the network fan-out); keep the real reactive
// `currentCourse` store + `__test__setSlots` + `recordItemVisit`. The main
// SequencePlayer file keeps the REAL `navigate`/`currentRoute` — its recipes
// depend on navigate's `target===current` early-return / hash-only
// short-circuit to resolve `currentItemId` synchronously inside flushSync.
vi.mock('../stores/currentCourse.svelte', async (importOriginal) => {
  const real = await importOriginal<typeof import('../stores/currentCourse.svelte')>();
  return { ...real, loadCourse: vi.fn().mockResolvedValue(undefined) };
});

import { __test__setSlots, loadCourse } from '../stores/currentCourse.svelte';
import { ApiError } from '../lib/api';
import { currentRoute } from '../lib/router.svelte';
import SequencePlayer from '../pages/SequencePlayer.svelte';
import type { BlockContent, Item } from '../lib/types';
import { expectRoutesInApp } from './support/routeClickProbe';
import { installLinkRouter } from '../lib/linkRouter';

const SLUG = 'algebra';

function page(id: number, seqId: number, title: string): Item {
  return {
    id,
    sequence_id: seqId,
    title,
    slug: `s-${id}`,
    order: 1,
    type: 'static_page',
    content_md: '',
    content_html: '<p>body</p>',
  };
}

// One block (B1 "Vectors") with two non-empty sequences + one empty sequence.
// Course-flat item order: 1001 (s100) → 1002 (s100) → 1003 (s200).
function seed(mapBlocks: (b: BlockContent[]) => BlockContent[] = (b) => b): void {
  __test__setSlots({
    slug: SLUG,
    versionId: 1,
    course: { id: 1, slug: SLUG, name: 'Linear Algebra' },
    version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
    blocks: mapBlocks([
      {
        id: 10,
        title: 'Vectors',
        slug: 'vectors',
        order: 1,
        info: '',
        info_html: '',
        sequences: [
          { id: 100, title: 'What a vector is', slug: 'what', order: 1, items: [page(1001, 100, 'Intro to vectors'), page(1002, 100, 'Vector notation')] },
          { id: 200, title: 'Vector operations', slug: 'ops', order: 2, items: [page(1003, 200, 'Adding vectors')] },
          { id: 300, title: 'Empty seq', slug: 'empty', order: 3, items: [] },
        ],
      },
    ]),
    state: { version_id: 1, items: {} },
    miniProjectsByBlockId: {}, teachers: [],
  });
}

// Seed the player's OWN route (path + history), not only the hash — this is
// what makes the resolution effect's navigate resolve synchronously inside
// flushSync rather than suspend at `await runGuards()`.
function seedRoute(seqId: number, hash: string): void {
  history.replaceState(null, '', `/courses/${SLUG}/seq/${seqId}`);
  currentRoute.path = `/courses/${SLUG}/seq/${seqId}`;
  currentRoute.search = '';
  currentRoute.hash = hash;
}

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(sequenceId: string): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(SequencePlayer, { target: host, props: { courseSlug: SLUG, sequenceId } });
  flushSync();
  return host;
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
  __test__setSlots(null);
  currentRoute.hash = '';
});

describe('SequencePlayer breadcrumb (T1)', () => {
  it('numbers the block in the crumb by its place in the list, not its stored order (gaps after a delete)', () => {
    seed((b) => [{ ...b[0], id: 9, title: 'Intro', order: 1, sequences: [] }, { ...b[0], order: 3 }]);
    seedRoute(100, '#item=1001');
    const el = render('100');
    expect(el.querySelector('nav.crumbs .crumb')!.textContent).toBe('2. Vectors');
  });

  it('C6: the course crumb routes a plain click in-app and leaves a ⌘-click to the browser', async () => {
    seed();
    seedRoute(100, '#item=1001');
    const el = render('100');
    await expectRoutesInApp(el.querySelector('nav.crumbs a')!, `/courses/${SLUG}`);
  });

  // C6: a content link to another sequence of the course routes in-app, and
  // without #item= the player picks that sequence's item, as a fresh load does.
  it('a move to another sequence without #item= opens an item of that sequence', async () => {
    seed();
    seedRoute(100, '#item=1001');
    host = document.createElement('div');
    document.body.appendChild(host);
    const props = $state({ courseSlug: SLUG, sequenceId: '100' });
    component = mount(SequencePlayer, { target: host, props });
    flushSync();
    expect(host.querySelector('.counter')!.textContent).toBe('Item 1 of 2');
    seedRoute(200, '');
    props.sequenceId = '200';
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(currentRoute.hash).toBe('#item=1003');
    expect(host.querySelector('.counter')!.textContent).toBe('Item 1 of 1');
  });

  it('C6: a #heading link in the item text leaves the player on its item', async () => {
    const teardown = installLinkRouter();
    try {
      seed();
      seedRoute(100, '#item=1001');
      const el = render('100');
      const prose = el.querySelector('.prose')!;
      prose.insertAdjacentHTML('beforeend', '<a id="to-heading" href="#intro">x</a><a id="to-top" href="#">y</a>');
      for (const id of ['to-heading', 'to-top']) {
        el.querySelector<HTMLAnchorElement>(`#${id}`)!.click();
        await new Promise((r) => setTimeout(r, 0));
        flushSync();
        expect(currentRoute.path).toBe(`/courses/${SLUG}/seq/100`);
        // The same item instance: the inserted link is still in its text.
        expect(prose.isConnected && prose.querySelector('#to-heading')).not.toBeNull();
      }
    } finally {
      teardown();
    }
  });

  it('renders a semantic breadcrumb ending in the sequence title, and a screen-reader-only h1', () => {
    seed();
    seedRoute(100, '#item=1001');
    const el = render('100');

    const nav = el.querySelector('nav.crumbs');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute('aria-label')).toBe('Breadcrumb');

    // course segment: a link to the course, no decorative back-arrow
    const link = nav!.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(`/courses/${SLUG}`);
    expect(link!.textContent).toContain('Linear Algebra');
    expect(link!.textContent).not.toContain('←');

    // block segment: ONE .crumb flex-item reading "{order}. {title}", as the
    // course page numbers its blocks (user, 2026-10-08) — no mono "B1" code.
    const crumb = nav!.querySelector('.crumb');
    expect(crumb).not.toBeNull();
    expect(crumb!.textContent).toBe('1. Vectors');
    expect(crumb!.querySelector('.mono')).toBeNull();

    // Last segment: the sequence TITLE (user, 2026-10-08). The course page no
    // longer shows S{order} codes, so "S1" here would be the only place a
    // student met one. It is the current page, so it says so to AT.
    const current = nav!.querySelector('.current');
    expect(current).not.toBeNull();
    expect(current!.classList.contains('mono')).toBe(false);
    expect(current!.textContent).toBe('What a vector is');
    expect(current!.getAttribute('aria-current')).toBe('page');

    // separators are their own flex items (one before block, one before the title)
    expect(nav!.querySelectorAll('.sep').length).toBe(2);

    // direct-child flex-item ORDER (load-bearing): a → .sep → .crumb → .sep → .current
    const kids = Array.from(nav!.children);
    expect(kids.length).toBe(5);
    expect(kids[0].tagName).toBe('A');
    expect(kids[1].classList.contains('sep')).toBe(true);
    expect(kids[2].classList.contains('crumb')).toBe(true);
    expect(kids[3].classList.contains('sep')).toBe(true);
    expect(kids[4].classList.contains('current')).toBe(true);

    // The visible heading is gone (the crumb names the page), but the page keeps
    // its h1 for screen-reader heading navigation: same text, visually hidden.
    const h1 = el.querySelector('h1.seq-title');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe('What a vector is');
    expect(h1!.classList.contains('sr-only')).toBe(true);
    expect(el.querySelectorAll('h1')).toHaveLength(1);
  });

  it('empty-sequence branch shares the breadcrumb + screen-reader-only h1', () => {
    seed();
    seedRoute(300, '');
    const el = render('300');

    const nav = el.querySelector('nav.crumbs');
    expect(nav).not.toBeNull();
    expect(nav!.querySelector('.current')!.textContent).toBe('Empty seq');

    const h1 = el.querySelector('h1.seq-title');
    expect(h1!.textContent).toBe('Empty seq');
    expect(h1!.classList.contains('sr-only')).toBe(true);
    expect(el.querySelector('.empty-state .title')!.textContent).toBe('This sequence has no items yet.');
  });
});

describe('SequencePlayer footer (T1 / D4; D93 the bottom bar)', () => {
  // D93 (user, Safari pass): Previous and Next are round arrow buttons in a bar
  // pinned to the window's bottom edge, with the item count between them, so
  // they stay put whatever the item's length. The count left the strip.
  const prevBtn = (el: HTMLElement) => el.querySelector('footer.player-nav button.nav-btn.prev') as HTMLButtonElement;
  const nextBtn = (el: HTMLElement) => el.querySelector('footer.player-nav button.nav-btn.next') as HTMLButtonElement;

  it('D93: the item count sits in the bottom bar, between the arrows, and no longer in the strip', () => {
    seed();
    seedRoute(100, '#item=1001');
    const el = render('100');
    expect(el.querySelector('nav.strip .counter')).toBeNull();
    const bar = el.querySelector('footer.player-nav') as HTMLElement;
    expect(Array.from(bar.children).map((c) => c.className.split(' ').filter((k) => !k.startsWith('svelte-')).join('.')))
      .toEqual(['nav-btn.prev', 'counter', 'nav-btn.next']);
    expect((bar.querySelector('.counter') as HTMLElement).textContent).toBe('Item 1 of 2');
  });

  it('the arrows are icon-only: the name is in aria-label, the glyph is hidden', () => {
    seed();
    seedRoute(100, '#item=1002'); // flatIndex 1: both enabled
    const el = render('100');
    for (const b of [prevBtn(el), nextBtn(el)]) {
      expect(b.getAttribute('type')).toBe('button');
      expect(b.textContent!.trim()).toBe('');
      expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    }
    expect(prevBtn(el).getAttribute('aria-label')).toBe('Previous item');
    expect(prevBtn(el).getAttribute('title')).toBe('Previous item');
  });

  it('Next is named "Next: {title}" mid-sequence; Previous disabled at flat start', () => {
    seed();
    seedRoute(100, '#item=1001'); // flatIndex 0
    const el = render('100');

    expect(prevBtn(el).disabled).toBe(true);
    expect(nextBtn(el).disabled).toBe(false);
    // D4 title reasons: disabled Previous at the first item carries the "first item"
    // reason (NOT "Loading…"); its name stays "Previous item".
    expect(prevBtn(el).getAttribute('title')).toBe("You're on the first item");
    expect(prevBtn(el).getAttribute('aria-label')).toBe('Previous item');
    expect(nextBtn(el).getAttribute('aria-label')).toBe('Next: Vector notation');
    expect(nextBtn(el).getAttribute('title')).toBe('Next: Vector notation');
  });

  it('Next crosses the sequence boundary (title from the next flat item in another sequence)', () => {
    seed();
    seedRoute(100, '#item=1002'); // flatIndex 1, last item of seq s100
    const el = render('100');
    expect(nextBtn(el).disabled).toBe(false);
    expect(nextBtn(el).getAttribute('aria-label')).toBe('Next: Adding vectors'); // lives in seq s200
  });

  it('whitespace-only next title falls back to a plain "Next item"', () => {
    __test__setSlots({
      slug: SLUG,
      versionId: 1,
      course: { id: 1, slug: SLUG, name: 'Linear Algebra' },
      version: { id: 1, state: 'published', info_html: '', max_quiz_attempts: 3 },
      blocks: [
        {
          id: 10, title: 'Vectors', slug: 'vectors', order: 1, info: '', info_html: '',
          sequences: [{ id: 100, title: 'S', slug: 's', order: 1, items: [page(1001, 100, 'First'), page(1002, 100, '   ')] }],
        },
      ],
      state: { version_id: 1, items: {} },
      miniProjectsByBlockId: {}, teachers: [],
    });
    seedRoute(100, '#item=1001'); // flatIndex 0; the next flat item (1002) has a whitespace-only title
    const el = render('100');
    expect(nextBtn(el).disabled).toBe(false);
    expect(nextBtn(el).getAttribute('aria-label')).toBe('Next item'); // guards the nextRef.title.trim() fallback
    expect(nextBtn(el).getAttribute('title')).toBe('Next item');
  });

  it('an invalid initial hash resolves to the first item (hash-only-change resolution path)', () => {
    seed();
    seedRoute(100, '#item=999999'); // non-member initial hash → resolveInitialItemId falls back to seq.items[0]
    const el = render('100');
    // resolution commits synchronously (isHashOnlyChange short-circuits guards) → currentItemId = 1001, flatIndex 0
    expect(nextBtn(el).disabled).toBe(false);
    expect(nextBtn(el).getAttribute('aria-label')).toBe('Next: Vector notation');
  });

  it('flatIndex < 0 (unresolved item): Next disabled and named "Next item", both arrows titled "Loading…"', () => {
    seed();
    seedRoute(100, '#item=1001');
    const el = render('100'); // currentItemId 1001, flatIndex 0

    // point the hash at a non-member id → currentItem null, flatIndex -1
    currentRoute.hash = '#item=999999';
    flushSync();

    expect(nextBtn(el).disabled).toBe(true);
    expect(nextBtn(el).getAttribute('aria-label')).toBe('Next item');
    expect(nextBtn(el).getAttribute('title')).toBe('Loading…');
    expect(prevBtn(el).getAttribute('title')).toBe('Loading…');
  });

  it('on the course\'s last item the bar holds Previous, the count and Finish, and no Next arrow', () => {
    seed();
    seedRoute(200, '#item=1003'); // the last flat item of the course
    const el = render('200');
    const bar = el.querySelector('footer.player-nav') as HTMLElement;
    expect(Array.from(bar.children).map((c) => c.className.split(' ').filter((k) => !k.startsWith('svelte-')).join('.')))
      .toEqual(['nav-btn.prev', 'counter', 'finish']);
    expect(bar.querySelector('.nav-btn.next')).toBeNull();
    const finish = bar.querySelector('.finish > button[data-variant="primary"]') as HTMLButtonElement;
    expect(finish.textContent).toContain('Finish sequence');
    expect(prevBtn(el).disabled).toBe(false);
    expect((bar.querySelector('.counter') as HTMLElement).textContent).toBe('Item 1 of 1');
  });

  it('the arrows move through the sequence', () => {
    seed();
    seedRoute(100, '#item=1001');
    const el = render('100');
    nextBtn(el).click();
    flushSync();
    expect(currentRoute.hash).toBe('#item=1002');
    expect((el.querySelector('footer .counter') as HTMLElement).textContent).toBe('Item 2 of 2');
    prevBtn(el).click();
    flushSync();
    expect(currentRoute.hash).toBe('#item=1001');
    expect((el.querySelector('footer .counter') as HTMLElement).textContent).toBe('Item 1 of 2');
  });
});

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

describe('SequencePlayer 9d states (Slice-4 T2)', () => {
  it('loading: Skeleton (3 rows) while the course loads; then "Sequence not found" page ErrorState when the store stays empty', async () => {
    // Store NOT seeded → the :16-29 effect takes the loadCourse branch.
    seedRoute(100, '');
    const el = render('100');
    expect(el.querySelector('.skeleton')).not.toBeNull();
    expect(el.querySelectorAll('.skeleton .row').length).toBe(3);

    await settle();   // mocked loadCourse resolves; the store is still null → !sequence branch
    const err = el.querySelector('.error-state.page');
    expect(err).not.toBeNull();
    expect(err!.querySelector('h1.title')!.textContent).toBe('Sequence not found');
    expect(err!.querySelector('.message')).toBeNull();               // title-only (§2)
    const back = err!.querySelector<HTMLButtonElement>('.action .btn');
    expect(back!.textContent?.trim()).toBe('Back to course');     // no ← glyph (enumerated 12)
  });

  it('error 404: page ErrorState with the verbatim copy and the Back action', async () => {
    vi.mocked(loadCourse).mockRejectedValueOnce(new ApiError(404, 'gone'));
    seedRoute(100, '');
    const el = render('100');
    await settle();
    const err = el.querySelector('.error-state.page');
    expect(err!.querySelector('h1.title')!.textContent).toBe('Sequence not available');
    expect(err!.querySelector('.message')!.textContent).toBe("This sequence isn't available to you.");
    expect(err!.querySelector('.action .btn')!.textContent?.trim()).toBe('Back to course');
  });

  it('error 500: generic heading + the backend message', async () => {
    vi.mocked(loadCourse).mockRejectedValueOnce(new ApiError(500, 'Server exploded.'));
    seedRoute(100, '');
    const el = render('100');
    await settle();
    const err = el.querySelector('.error-state.page');
    expect(err!.querySelector('h1.title')!.textContent).toBe("Couldn't load");
    expect(err!.querySelector('.message')!.textContent).toBe('Server exploded.');
  });
});
