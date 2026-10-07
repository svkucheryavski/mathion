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
    draft: opt().text, correct: false, frozen: false, optionsLocked: false, canDelete: true, mutating: false,
    onMark: vi.fn(), onDelete: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), ...over,
  });
  const cmp = mount(OptionRow, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return { target, props };
}
const textInput = (t: HTMLElement) => t.querySelector('[data-testid="option-text"]') as HTMLInputElement;
const btn = (t: HTMLElement, label: string) => t.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

it('renders the bound draft text', () => {
  const { target } = mountRow({ draft: 'Berlin' });
  expect(textInput(target).value).toBe('Berlin');
});

it('typing writes the bound draft; nothing is committed (the footer Save sends it)', () => {
  const { target, props } = mountRow();
  textInput(target).value = 'Rome';
  textInput(target).dispatchEvent(new Event('input', { bubbles: true }));
  textInput(target).dispatchEvent(new Event('blur'));
  flushSync();
  expect(props.draft).toBe('Rome');
  expect(props.onMark).not.toHaveBeenCalled();
});

it('the correct badge and the row class follow the DRAFT mark, not the saved one (D25)', () => {
  const a = mountRow({ correct: true, option: opt({ is_correct: false }) });
  expect(a.target.querySelector('[data-testid="option-correct"]')!.textContent).toBe('correct');
  expect(a.target.querySelector('.option')!.classList.contains('correct')).toBe(true);
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const b = mountRow({ correct: false, option: opt({ is_correct: true }) });
  expect(b.target.querySelector('[data-testid="option-correct"]')).toBeNull();
  expect(b.target.querySelector('.option')!.classList.contains('correct')).toBe(false);
});

it('↑/↓/delete fire their callbacks', () => {
  const onMoveUp = vi.fn(), onMoveDown = vi.fn(), onDelete = vi.fn();
  const { target } = mountRow({ index: 2, count: 3, onMoveUp, onMoveDown, onDelete });
  btn(target, 'Move option up').click();
  btn(target, 'Move option down').click();
  btn(target, 'Delete option').click();
  expect(onMoveUp).toHaveBeenCalledOnce();
  expect(onMoveDown).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledOnce();
});

it('optionsLocked disables the structure buttons but leaves the text and the mark editable', () => {
  const { target } = mountRow({ index: 2, count: 3, optionsLocked: true });
  expect(btn(target, 'Move option up').disabled).toBe(true);
  expect(btn(target, 'Delete option').disabled).toBe(true);
  expect(textInput(target).readOnly).toBe(false);
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(false);
});

it('frozen: the text is readonly without losing focus, and the mark is disabled (D10)', () => {
  const { target, props } = mountRow();
  textInput(target).focus();
  props.frozen = true;
  flushSync();
  expect(textInput(target).readOnly).toBe(true);
  expect(document.activeElement).toBe(textInput(target));
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
});

it('canDelete=false disables only delete (C2)', () => {
  const { target } = mountRow({ index: 2, canDelete: false });
  expect(btn(target, 'Delete option').disabled).toBe(true);
  expect(btn(target, 'Move option up').disabled).toBe(false);
});

it('reorder boundaries disable ↑ at top and ↓ at bottom', () => {
  const top = mountRow({ index: 1, count: 3 });
  expect(btn(top.target, 'Move option up').disabled).toBe(true);
  expect(btn(top.target, 'Move option down').disabled).toBe(false);
  cleanup?.(); cleanup = null; document.body.innerHTML = '';
  const bottom = mountRow({ index: 3, count: 3 });
  expect(btn(bottom.target, 'Move option down').disabled).toBe(true);
});

it('single_choice: a radio reflecting the draft mark; picking it calls onMark(true)', () => {
  const onMark = vi.fn();
  const { target } = mountRow({ questionType: 'single_choice', correct: false, onMark });
  const radio = target.querySelector('input[type="radio"]') as HTMLInputElement;
  expect(radio.checked).toBe(false);
  radio.click();
  expect(onMark).toHaveBeenCalledWith(true);
});

it('multiple_choice: a checkbox reflecting the draft mark; clicking it calls onMark with the new state', () => {
  const onMark = vi.fn();
  const { target } = mountRow({ questionType: 'multiple_choice', correct: true, onMark });
  const box = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(box.checked).toBe(true);
  box.click();
  expect(onMark).toHaveBeenCalledWith(false);
});

it('mutating keeps the structure buttons natively enabled, so a clicked button keeps focus', () => {
  // In flight the accordion passes optionsLocked AND mutating; its handlers
  // guard re-entry. Disabling the clicked button would blur it to <body>.
  const { target } = mountRow({ index: 2, count: 3, optionsLocked: true, mutating: true });
  expect(btn(target, 'Move option up').disabled).toBe(false);
});

it('a read-only version: text readonly, mark disabled, no structure buttons', () => {
  const RO = versionPermissions({ state: 'archived', is_disabled: false });
  const { target } = mountRow({ perms: RO });
  expect(textInput(target).readOnly).toBe(true);
  expect((target.querySelector('input[type="radio"]') as HTMLInputElement).disabled).toBe(true);
  expect(btn(target, 'Delete option')).toBeNull();
});
