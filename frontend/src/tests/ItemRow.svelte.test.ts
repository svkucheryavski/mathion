import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemRow from '../components/editor/ItemRow.svelte';
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
    item: item(), index: 1, canStructure: true, canReorderUp: true,
    canReorderDown: true, parentDirty: false, busy: false,
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
