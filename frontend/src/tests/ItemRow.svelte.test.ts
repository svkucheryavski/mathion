import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemRow from '../components/editor/ItemRow.svelte';
import ItemMark from '../components/course/ItemMark.svelte';
import type { AdminTreeItem } from '../lib/types';

const item = (over: Partial<AdminTreeItem> = {}): AdminTreeItem => ({
  id: 1, sequence_id: 9, title: 'Pop quiz', slug: 'pop-quiz', order: 1,
  type: 'quiz', content_md: null, content_html: null, video_url: null,
  script_url: null, questions_count: 3, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    item: item(), index: 1, structureReason: null, canReorderUp: true,
    canReorderDown: true, busy: false,
    onMoveUp: vi.fn(), onMoveDown: vi.fn(), onOpen: vi.fn(), onDelete: vi.fn(), ...over,
  });
  const cmp = mount(ItemRow, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}
const count = (t: HTMLElement) => t.querySelector('[data-testid="item-question-count"]');

it('a quiz item row shows its questions_count (plural)', () => {
  const { target } = mountRow({ item: item({ questions_count: 3 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('3 questions');
});

it('a single-question quiz uses the singular noun', () => {
  const { target } = mountRow({ item: item({ questions_count: 1 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('1 question');
});

it('a zero-question quiz still renders the count (plural)', () => {
  const { target } = mountRow({ item: item({ questions_count: 0 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('0 questions');
});

it('non-quiz item types do NOT render a question count', () => {
  const { target } = mountRow({ item: item({ type: 'static_page', questions_count: 0 }) });
  flushSync();
  expect(count(target)).toBeNull();
});

it('the count updates reactively when questions_count changes (the post-delete refresh path)', () => {
  const { target, props } = mountRow({ item: item({ questions_count: 3 }) });
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('3 questions');
  props.item = item({ questions_count: 2 });   // loadAdminTree refresh replaces the item prop
  flushSync();
  expect(count(target)?.textContent?.trim()).toBe('2 questions');
});

// Slice-5a T6: ItemMark replaces the emoji glyph; four fixed icon slots.
const slot = (t: HTMLElement, glyph: string) => t.querySelector<HTMLButtonElement>(`.actions button[data-glyph="${glyph}"]`)!;
const EMOJI = /\p{Extended_Pictographic}/u;

describe('ItemRow — 3b treatment (T6)', () => {
  it('leads with a not-yet ItemMark of the item type and carries no emoji', () => {
    const { target } = mountRow({ item: item({ type: 'video' }) });
    flushSync();
    const mark = target.querySelector('.item-row > .item-mark')!;
    expect(mark.classList.contains('not-yet')).toBe(true);
    expect(target.querySelector('.glyph')).toBeNull();
    expect(EMOJI.test(target.textContent ?? '')).toBe(false);
  });

  it('title, mono slug (aria-hidden), and for a quiz the faint separator + mono count', () => {
    const { target } = mountRow();
    flushSync();
    expect(target.querySelector('.item-title')!.textContent).toBe('Pop quiz');
    const slug = target.querySelector('.item-slug')!;
    expect(slug.textContent).toBe('/pop-quiz');
    expect(slug.classList.contains('mono')).toBe(true);
    expect(slug.getAttribute('aria-hidden')).toBe('true');
    expect(target.querySelector('.sep')!.getAttribute('aria-hidden')).toBe('true');
    expect(count(target)!.classList.contains('mono')).toBe(true);
  });

  it('four slots in order ↑ ↓ open delete, named after the item', () => {
    const { target } = mountRow();
    flushSync();
    const slots = [...target.querySelectorAll<HTMLButtonElement>('.actions button')];
    expect(slots.map((b) => b.dataset.glyph)).toEqual(['up', 'down', 'pencil', 'trash']);
    expect(slots.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move item up: Pop quiz', 'Move item down: Pop quiz', 'Open Pop quiz', 'Delete Pop quiz',
    ]);
    expect(slots.map((b) => b.title)).toEqual(['Move up', 'Move down', 'Open', 'Delete']);
    expect(slots.every((b) => !b.disabled)).toBe(true);
  });

  it('boundary arrows stay rendered, disabled with "already first/last"', () => {
    const { target } = mountRow({ canReorderUp: false, canReorderDown: false });
    flushSync();
    expect(slot(target, 'up').disabled).toBe(true);
    expect(slot(target, 'up').title).toBe('Move up — already first');
    expect(slot(target, 'down').disabled).toBe(true);
    expect(slot(target, 'down').title).toBe('Move down — already last');
  });

  it('a structure reason disables ↑ ↓ delete with the reason; Open stays enabled', () => {
    const reason = 'Only a created version can change its structure';
    const { target } = mountRow({ structureReason: reason, canReorderUp: false });
    flushSync();
    for (const g of ['up', 'down', 'trash']) {
      expect(slot(target, g).disabled).toBe(true);
      expect(slot(target, g).title).toBe(reason);
    }
    expect(slot(target, 'pencil').disabled).toBe(false);
  });

  it('the mark is the item\'s own type (compared with a standalone ItemMark)', () => {
    for (const type of ['quiz', 'video'] as const) {
      const { target } = mountRow({ item: item({ type }) });
      flushSync();
      const ref = document.createElement('div');
      const m = mount(ItemMark, { target: ref, props: { type, state: 'not-yet' } });
      flushSync();
      expect(target.querySelector('.item-row > .item-mark')!.outerHTML).toBe(ref.querySelector('.item-mark')!.outerHTML);
      unmount(m);
      cleanup?.(); cleanup = null; document.body.innerHTML = '';
    }
  });

  it('with no title and no slug: "(item N)" visibly, no slug, slot names end in the plain placeholder', () => {
    const { target } = mountRow({ item: item({ title: '', slug: '' }), index: 2 });
    flushSync();
    expect(target.querySelector('.item-title')!.textContent).toBe('(item 2)');
    expect(target.querySelector('.item-slug')).toBeNull();
    expect([...target.querySelectorAll('.actions button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move item up: item 2', 'Move item down: item 2', 'Open item 2', 'Delete item 2',
    ]);
  });

  it('busy disables every slot', () => {
    const { target } = mountRow({ busy: true });
    flushSync();
    expect([...target.querySelectorAll<HTMLButtonElement>('.actions button')].every((b) => b.disabled)).toBe(true);
  });

  it('each enabled slot calls its handler', () => {
    const onMoveUp = vi.fn(), onMoveDown = vi.fn(), onOpen = vi.fn(), onDelete = vi.fn();
    const { target } = mountRow({ onMoveUp, onMoveDown, onOpen, onDelete });
    flushSync();
    slot(target, 'up').click();
    slot(target, 'down').click();
    slot(target, 'pencil').click();
    slot(target, 'trash').click();
    expect([onMoveUp, onMoveDown, onOpen, onDelete].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });
});
