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
});
