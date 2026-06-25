import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import OptionRow from '../components/editor/OptionRow.svelte';
import type { AuthoringOption } from '../lib/quizAuthoring';

const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 7, text: 'Paris', is_correct: false, order: 1, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: Record<string, unknown> = $state({
    option: opt(), index: 1, count: 1, questionType: 'single_choice', ...over,
  });
  const cmp = mount(OptionRow, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}

it('renders the option text', () => {
  const { target } = mountRow({ option: opt({ text: 'Berlin' }) });
  flushSync();
  expect((target.querySelector('[data-testid="option-text"]') as HTMLInputElement).value).toBe('Berlin');
});

it('shows a visible "✓ correct" marker only for correct options', () => {
  const { target } = mountRow({ option: opt({ is_correct: true }) });
  flushSync();
  expect(target.querySelector('[data-testid="option-correct"]')).not.toBeNull();
  expect(target.querySelector('[data-testid="option-correct"]')?.textContent).toContain('✓');
});

it('omits the marker for incorrect options', () => {
  const { target } = mountRow({ option: opt({ is_correct: false }) });
  flushSync();
  expect(target.querySelector('[data-testid="option-correct"]')).toBeNull();
});
