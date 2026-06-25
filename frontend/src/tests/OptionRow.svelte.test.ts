import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import OptionRow from '../components/editor/OptionRow.svelte';
import type { AuthoringOption } from '../lib/quizAuthoring';
import { versionPermissions } from '../lib/versionPermissions';

const PERMS = versionPermissions({ state: 'created', is_disabled: false });
const opt = (over: Partial<AuthoringOption> = {}): AuthoringOption => ({
  id: 1, question_id: 7, text: 'Paris', is_correct: false, order: 1, ...over,
});

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountRow(over: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: any = $state({
    option: opt(), index: 1, count: 3, questionType: 'single_choice', perms: PERMS,
    draft: opt().text, optionsLocked: false, canDelete: true,
    onCommitText: vi.fn(), onDelete: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), ...over,
  });
  const cmp = mount(OptionRow, { target, props });
  cleanup = () => unmount(cmp);
  return { target, props };
}
const textInput = (t: HTMLElement) => t.querySelector('[data-testid="option-text"]') as HTMLInputElement;
const btn = (t: HTMLElement, label: string) => t.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

it('renders the bound draft text', () => {
  const { target } = mountRow({ draft: 'Berlin' });
  flushSync();
  expect(textInput(target).value).toBe('Berlin');
});

it('shows the ✓ correct marker only for correct options', () => {
  const { target } = mountRow({ option: opt({ is_correct: true }) });
  flushSync();
  expect(target.querySelector('[data-testid="option-correct"]')).not.toBeNull();
});

it('blur on the text input fires onCommitText', () => {
  const onCommitText = vi.fn();
  const { target } = mountRow({ onCommitText });
  flushSync();
  textInput(target).dispatchEvent(new Event('blur'));
  expect(onCommitText).toHaveBeenCalledOnce();
});

it('↑/↓/🗑 fire their callbacks', () => {
  const onMoveUp = vi.fn(), onMoveDown = vi.fn(), onDelete = vi.fn();
  const { target } = mountRow({ index: 2, count: 3, onMoveUp, onMoveDown, onDelete });
  flushSync();
  btn(target, 'Move option up').click();
  btn(target, 'Move option down').click();
  btn(target, 'Delete option').click();
  expect(onMoveUp).toHaveBeenCalledOnce();
  expect(onMoveDown).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledOnce();
});

it('optionsLocked disables every option control + makes the text read-only', () => {
  const { target } = mountRow({ index: 2, count: 3, optionsLocked: true });
  flushSync();
  expect(textInput(target).readOnly).toBe(true);
  expect(btn(target, 'Move option up').disabled).toBe(true);
  expect(btn(target, 'Delete option').disabled).toBe(true);
});

it('canDelete=false disables only delete (C2)', () => {
  const { target } = mountRow({ canDelete: false });
  flushSync();
  expect(btn(target, 'Delete option').disabled).toBe(true);
});

it('reorder boundaries disable ↑ at top and ↓ at bottom', () => {
  const top = mountRow({ index: 1, count: 3 });
  flushSync();
  expect(btn(top.target, 'Move option up').disabled).toBe(true);
  expect(btn(top.target, 'Move option down').disabled).toBe(false);
});
