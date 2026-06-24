import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemTypePicker from '../components/editor/ItemTypePicker.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('offers a quiz radio and binds it', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'static_page' | 'video' | 'quiz' } = $state({ value: 'static_page' });
  const cmp = mount(ItemTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const quiz = target.querySelector('input[value="quiz"]') as HTMLInputElement;
  expect(quiz).not.toBeNull();
  quiz.click();
  flushSync();
  expect(props.value).toBe('quiz');
});
