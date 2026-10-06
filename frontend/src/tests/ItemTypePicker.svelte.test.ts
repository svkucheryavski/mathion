import { it, expect, afterEach } from 'vitest';
import type { AdminTreeItem } from '../lib/types';
import { mount, unmount, flushSync } from 'svelte';
import ItemTypePicker from '../components/editor/ItemTypePicker.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('offers a quiz radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' | 'interactive_app' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const quiz = target.querySelector('input[value="quiz"]') as HTMLInputElement;
  expect(quiz).not.toBeNull();
  quiz.click();
  flushSync();
  expect(props.value).toBe('quiz');
});

it('offers an interactive_app radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' | 'interactive_app' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const radio = target.querySelector('input[value="interactive_app"]') as HTMLInputElement;
  expect(radio).not.toBeNull();
  radio.click();
  flushSync();
  expect(props.value).toBe('interactive_app');
});

type T = AdminTreeItem['type'];
function mountPicker(value: T = 'static_page') {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: T } = $state({ value });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, props };
}

it('renders four labelled cards, each led by a not-yet ItemMark — no emoji (T6)', () => {
  const { target } = mountPicker();
  expect(target.querySelector('fieldset.type-picker > legend')!.textContent).toBe('Item type');
  const cards = [...target.querySelectorAll('label')];
  expect(cards.map((c) => c.textContent?.trim())).toEqual(['Page', 'Video', 'Quiz', 'Interactive app']);
  expect(cards.every((c) => c.querySelector('.item-mark.not-yet'))).toBe(true);
  expect(/\p{Extended_Pictographic}/u.test(target.textContent ?? '')).toBe(false);
});

it('marks only the checked card as selected, and follows a change', () => {
  const { target } = mountPicker('video');
  const selected = () => [...target.querySelectorAll('label.selected')].map((c) => c.textContent?.trim());
  expect(selected()).toEqual(['Video']);
  target.querySelector<HTMLInputElement>('input[value="quiz"]')!.click();
  flushSync();
  expect(selected()).toEqual(['Quiz']);
});

it('the four radios form one group (name="item-type") — arrow keys move within it', () => {
  const { target } = mountPicker();
  expect([...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => r.name)).toEqual(
    ['item-type', 'item-type', 'item-type', 'item-type'],
  );
});
