import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import QuestionTypePicker from '../components/editor/QuestionTypePicker.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

it('offers four type radios and binds the selection', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer' } =
    $state({ value: 'single_choice' });
  const cmp = mount(QuestionTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  expect(target.querySelectorAll('input[name="question-type"]')).toHaveLength(4);
  (target.querySelector('input[value="numeric_answer"]') as HTMLInputElement).click();
  flushSync();
  expect(props.value).toBe('numeric_answer');
});

it('renders 5a-style cards: lowercase names, the selected card marked, no glyphs (Slice-5b T6)', () => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: { value: 'single_choice' | 'multiple_choice' | 'numeric_answer' | 'text_answer'; disabled?: boolean } =
    $state({ value: 'numeric_answer' });
  const cmp = mount(QuestionTypePicker, { target, props });
  cleanup = () => unmount(cmp);
  const labels = [...target.querySelectorAll('label')];
  expect(labels.map((l) => l.textContent!.trim())).toEqual(['single choice', 'multiple choice', 'numeric answer', 'text answer']);
  expect(labels.map((l) => l.classList.contains('selected'))).toEqual([false, false, true, false]);
  expect(target.querySelector('.glyph')).toBeNull();
  props.disabled = true;
  flushSync();
  expect([...target.querySelectorAll('input')].every((i) => i.disabled)).toBe(true);
});
