import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
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

  it('an inactive trap leaves Tab alone (5d: only the top modal traps)', () => {
    const snippet = (() => '') as unknown as Snippet;
    let active = true;
    component = mount(FocusTrap, { target, props: { children: snippet, active: () => active } });
    flushSync();
    const container = target.firstElementChild as HTMLElement;
    const a = document.createElement('button');
    const b = document.createElement('button');
    container.append(a, b);
    b.focus();
    const tab = () => {
      const e = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true });
      document.dispatchEvent(e);
      return e;
    };
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    b.focus();
    active = false;
    expect(tab().defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(b);
  });

  // ---- Polish 3 C7 point 5 (F5): the autofocus target must be able to hold focus.
  const html = (markup: string) => createRawSnippet(() => ({ render: () => `<div>${markup}</div>` }));
  const micro = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

  it('autofocus skips a disabled match and falls through to the next, then the first [tabindex=-1]', async () => {
    component = mount(FocusTrap, {
      target,
      props: { autofocusSelector: '#a, #b', autofocusPriorityOrder: true,
               children: html('<button id="a" disabled>A</button><button id="b" aria-disabled="true">B</button>') },
    });
    flushSync();
    await micro();
    expect(document.activeElement?.id).toBe('b');      // aria-disabled holds focus
    unmount(component); component = null;

    component = mount(FocusTrap, {
      target,
      props: { autofocusSelector: '#a', autofocusPriorityOrder: true,
               children: html('<section id="p" tabindex="-1"><button id="a" disabled>A</button></section>') },
    });
    flushSync();
    await micro();
    expect(document.activeElement?.id).toBe('p');
    unmount(component); component = null;

    // The DOM-order branch skips it too.
    component = mount(FocusTrap, {
      target,
      props: { autofocusSelector: 'button',
               children: html('<span><button id="a" disabled>A</button><span inert><button id="i">I</button></span><button id="c">C</button></span>') },
    });
    flushSync();
    await micro();
    expect(document.activeElement?.id).toBe('c');
  });

  // ---- Polish 3 C7 point 6 (F13): Safari leaves a clicked button unfocused.
  function opener(parent: Element = document.body): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = 'Open';
    parent.appendChild(b);
    return b;
  }
  const pointerdown = (el: Element) => el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
  const onBody = () => { (document.activeElement as HTMLElement | null)?.blur?.(); expect(document.activeElement).toBe(document.body); };
  async function openAndClose() {
    component = mount(FocusTrap, { target, props: { children: html('<button id="in">In</button>') } });
    flushSync();
    await micro();
    unmount(component); component = null;
  }

  it('a trap opened after a pointerdown on a button, with focus on body, returns focus to that button on close', async () => {
    const b = opener();
    onBody();
    pointerdown(b);
    await openAndClose();
    expect(document.activeElement).toBe(b);
    b.remove();
  });

  it('the same when focus sits on an ancestor of the pressed control', async () => {
    const wrap = document.createElement('section');
    wrap.tabIndex = -1;
    document.body.appendChild(wrap);
    const span = document.createElement('span');
    const b = opener(wrap);
    b.appendChild(span);
    wrap.focus();
    pointerdown(span);                         // the press lands on the button's child
    await openAndClose();
    expect(document.activeElement).toBe(b);
    wrap.remove();
  });

  it('a keydown after the press clears the record', async () => {
    const b = opener();
    onBody();
    pointerdown(b);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await openAndClose();
    expect(document.activeElement).not.toBe(b);
    b.remove();
  });

  it('a press on a non-control resets the record', async () => {
    const b = opener();
    const plain = document.createElement('p');
    document.body.appendChild(plain);
    onBody();
    pointerdown(b);
    pointerdown(plain);
    await openAndClose();
    expect(document.activeElement).not.toBe(b);
    b.remove();
    plain.remove();
  });

  it('focus already on the opener is kept as is (keyboard, Chrome)', async () => {
    const pressed = opener();
    const other = opener();
    pointerdown(pressed);
    other.focus();                             // focus is somewhere real, not an ancestor
    await openAndClose();
    expect(document.activeElement).toBe(other);
    pressed.remove();
    other.remove();
  });

  it('a recorded control that left the page is not the return target', async () => {
    const b = opener();
    onBody();
    pointerdown(b);
    b.remove();
    await openAndClose();
    expect(document.activeElement).toBe(document.body);
  });

  // r1 Opus M2: a press on a control that cannot hold focus, or a right or
  // middle press, keeps the old return target (here a focused ancestor).
  it('a press on a disabled control, or a non-primary press, keeps the focused ancestor', async () => {
    const wrap = document.createElement('section');
    wrap.tabIndex = -1;
    document.body.appendChild(wrap);
    const off = opener(wrap);
    off.disabled = true;
    wrap.focus();
    pointerdown(off);
    await openAndClose();
    expect(document.activeElement).toBe(wrap);

    const on = opener(wrap);
    wrap.focus();
    on.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 2 }));
    await openAndClose();
    expect(document.activeElement).toBe(wrap);
    wrap.remove();
  });

  // r2 Fable 1: a [role=button] that focus cannot reach is not an opener.
  it('a press on a [role=button] without tabindex keeps the focused ancestor', async () => {
    const wrap = document.createElement('section');
    wrap.tabIndex = -1;
    document.body.appendChild(wrap);
    const fake = document.createElement('span');
    fake.setAttribute('role', 'button');
    wrap.appendChild(fake);
    wrap.focus();
    pointerdown(fake);
    await openAndClose();
    expect(document.activeElement).toBe(wrap);
    wrap.remove();
  });

  // r2 Fable 3: the priority branch walks every match of one selector.
  it('priority order: a disabled first [data-autofocus] falls through to the second', async () => {
    component = mount(FocusTrap, {
      target,
      props: { autofocusSelector: '[data-autofocus], #x', autofocusPriorityOrder: true,
               children: html('<button id="x">X</button><button id="a" data-autofocus disabled>A</button><button id="b" data-autofocus>B</button>') },
    });
    flushSync();
    await micro();
    expect(document.activeElement?.id).toBe('b');
  });
});
