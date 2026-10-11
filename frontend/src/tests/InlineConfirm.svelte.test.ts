import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InlineConfirm from '../components/ui/InlineConfirm.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) unmount(component); document.body.removeChild(target); vi.restoreAllMocks(); });

describe('InlineConfirm', () => {
  it('renders [Confirm] [Cancel] pair when mounted', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {} } });
    flushSync();
    const buttons = Array.from(target.querySelectorAll('button'));
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.textContent?.trim()).toBe('Confirm');
    expect(buttons[1]!.textContent?.trim()).toBe('Cancel');
  });

  it('uses confirmLabel when provided', () => {
    component = mount(InlineConfirm, { target, props: { confirmLabel: 'Confirm Delete — 3 students', onConfirm: () => {} } });
    flushSync();
    expect(target.querySelectorAll('button')[0]!.textContent?.trim()).toBe('Confirm Delete — 3 students');
  });

  it('renders warning above the pair when provided', () => {
    component = mount(InlineConfirm, { target, props: { warning: 'Students lose access.', onConfirm: () => {} } });
    flushSync();
    expect(target.textContent).toContain('Students lose access.');
  });

  it('Confirm click invokes onConfirm', () => {
    const onConfirm = vi.fn();
    component = mount(InlineConfirm, { target, props: { onConfirm } });
    flushSync();
    (target.querySelectorAll('button')[0] as HTMLButtonElement).click();
    flushSync();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Cancel click invokes onCancel (when provided) and does NOT invoke onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    component = mount(InlineConfirm, { target, props: { onConfirm, onCancel } });
    flushSync();
    (target.querySelectorAll('button')[1] as HTMLButtonElement).click();
    flushSync();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancel click without onCancel prop is a no-op (no throw)', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {} } });
    flushSync();
    expect(() => (target.querySelectorAll('button')[1] as HTMLButtonElement).click()).not.toThrow();
  });

  it('confirmDataAction is reflected on the confirm button when provided', () => {
    component = mount(InlineConfirm, { target, props: { confirmDataAction: 'confirm-delete-item', onConfirm: () => {} } });
    flushSync();
    const confirmBtn = target.querySelectorAll('button')[0]!;
    expect(confirmBtn.getAttribute('data-action')).toBe('confirm-delete-item');
  });

  it('takeFocus: Cancel takes focus on mount (6a P3)', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {}, onCancel: () => {}, takeFocus: true } });
    flushSync();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  });

  it('takeFocus: Esc on either button cancels', () => {
    const onCancel = vi.fn();
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {}, onCancel, takeFocus: true } });
    flushSync();
    const [confirm, cancel] = Array.from(target.querySelectorAll('button'));
    cancel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    confirm!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('without takeFocus: focus is untouched and Esc is ignored', () => {
    const onCancel = vi.fn();
    const before = document.activeElement;
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {}, onCancel } });
    flushSync();
    expect(document.activeElement).toBe(before);
    target.querySelectorAll('button')[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('is a group named by its warning, so a screen reader says what Cancel cancels (final review)', () => {
    component = mount(InlineConfirm, { target, props: { warning: 'Delete this asset?', takeFocus: true, onConfirm: () => {} } });
    flushSync();
    const g = target.querySelector('.inline-confirm') as HTMLElement;
    expect(g.getAttribute('role')).toBe('group');
    const id = g.getAttribute('aria-labelledby')!;
    expect(document.getElementById(id)?.textContent).toBe('Delete this asset?');
  });

  it('a label names the group when there is no warning (final review)', () => {
    component = mount(InlineConfirm, { target, props: { label: 'Delete Alpha?', onConfirm: () => {} } });
    flushSync();
    const g = target.querySelector('.inline-confirm') as HTMLElement;
    expect(g.getAttribute('role')).toBe('group');
    expect(g.getAttribute('aria-label')).toBe('Delete Alpha?');
  });

  it('with neither, it is no group', () => {
    component = mount(InlineConfirm, { target, props: { onConfirm: () => {} } });
    flushSync();
    expect(target.querySelector('.inline-confirm')?.hasAttribute('role')).toBe(false);
  });
});
