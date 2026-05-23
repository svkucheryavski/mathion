import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { Snippet } from 'svelte';
import FocusTrap from '../components/ui/FocusTrap.svelte';

const noopSnippet = (() => '') as unknown as Snippet;

let outer: HTMLDivElement;
let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  outer = document.createElement('div');
  target = document.createElement('div');
  outer.appendChild(target);
  document.body.appendChild(outer);
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  document.body.removeChild(outer);
  vi.restoreAllMocks();
});

describe('FocusTrap', () => {
  it('attaches and detaches a keydown listener on document', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    component = mount(FocusTrap, { target, props: { children: noopSnippet } });
    flushSync();
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    unmount(component);
    component = null;
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });
  it('captures previousFocus from document.activeElement', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement?.id).toBe('trigger');
    component = mount(FocusTrap, { target, props: { children: noopSnippet } });
    flushSync();
    // FocusTrap should have captured trigger as previousFocus internally.
    // We assert behavior by destroying and checking trigger is re-focused.
    // (jsdom focus is partially broken; rely on focus call rather than activeElement.)
    const focusSpy = vi.spyOn(trigger, 'focus');
    unmount(component);
    component = null;
    expect(focusSpy).toHaveBeenCalled();
    document.body.removeChild(trigger);
  });
  it('isConnected=false branch: restore no-ops without throwing', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    component = mount(FocusTrap, { target, props: { children: noopSnippet } });
    flushSync();
    // Remove the trigger to simulate unmounted (e.g., success-navigate path).
    document.body.removeChild(trigger);
    expect(trigger.isConnected).toBe(false);
    // Should not throw.
    expect(() => { unmount(component!); component = null; }).not.toThrow();
  });
});
