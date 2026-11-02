import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Harness from './support/ModalHarness.svelte';
import NestedHarness from './support/NestedModalHarness.svelte';
import { isTopModal } from '../components/ui/Modal.svelte';

let target: HTMLDivElement | null = null;
let cmp: ReturnType<typeof mount> | null = null;

async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); flushSync(); }
function render(over: Record<string, unknown> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({ onRequestClose: vi.fn(), ...over });
  cmp = mount(Harness, { target, props });
  flushSync();
  return props as { onRequestClose: ReturnType<typeof vi.fn> } & Record<string, unknown>;
}
afterEach(() => {
  if (cmp) { unmount(cmp); cmp = null; }
  target?.remove(); target = null;
  document.documentElement.style.overflow = '';
});

const panel = () => document.querySelector<HTMLElement>('section.modal-panel')!;
const backdrop = () => document.querySelector<HTMLElement>('div.modal-backdrop')!;
const closeBtn = () => panel().querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
function esc(init: KeyboardEventInit = {}, on: EventTarget = window) {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
  on.dispatchEvent(ev);
  return ev;
}

describe('Modal — identity', () => {
  it('is a labelled modal dialog with a focusable panel', () => {
    render();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-modal')).toBe('true');
    expect(panel().getAttribute('aria-labelledby')).toBe('mh-title');
    expect(panel().getAttribute('tabindex')).toBe('-1');
  });

  it('renders the footer only when a footer snippet is given', () => {
    render({ withFooter: false });
    expect(panel().querySelector('footer.modal-foot')).toBeNull();
    unmount(cmp!); cmp = null; target!.remove();
    render();
    expect(panel().querySelector('footer.modal-foot [data-testid="save"]')).not.toBeNull();
  });
});

describe('Modal — closing', () => {
  it('× calls onRequestClose', () => {
    const p = render();
    closeBtn().click();
    expect(p.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('Escape calls onRequestClose and is default-prevented', () => {
    const p = render();
    const ev = esc();
    expect(p.onRequestClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Escape is ignored while composing, on keyCode 229, on repeat and after an inner preventDefault', () => {
    const p = render();
    esc({ isComposing: true });
    const ime = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    Object.defineProperty(ime, 'keyCode', { value: 229 });
    window.dispatchEvent(ime);
    esc({ repeat: true });
    const input = byId('title');
    input.addEventListener('keydown', (e) => e.preventDefault());
    esc({}, input);
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('closeDisabled disables × and ignores Escape', () => {
    const p = render({ closeDisabled: true });
    expect(closeBtn().disabled).toBe(true);
    esc();
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('a backdrop click does nothing by default', () => {
    const p = render();
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('closeOnBackdrop closes on a backdrop click, never on a click inside the panel', () => {
    const p = render({ closeOnBackdrop: true });
    panel().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    byId('title').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).not.toHaveBeenCalled();
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('a backdrop mousedown is default-prevented; a panel mousedown is not', () => {
    render();
    const onBackdrop = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    backdrop().dispatchEvent(onBackdrop);
    expect(onBackdrop.defaultPrevented).toBe(true);
    const onPanel = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    byId('title').dispatchEvent(onPanel);
    expect(onPanel.defaultPrevented).toBe(false);
  });
});

describe('Modal — focus', () => {
  it('autofocus lands on [data-autofocus], never on the header button', async () => {
    render();
    await settle();
    expect(document.activeElement).toBe(byId('title'));
  });

  it('autofocus falls back to × when nothing is marked', async () => {
    render({ autofocusTitle: false });
    await settle();
    expect(document.activeElement).toBe(closeBtn());
  });

  it('focus that lands outside the panel is moved back to the first focusable', async () => {
    render();
    await settle();
    byId('outside').focus();
    expect(document.activeElement).toBe(byId('head-trash'));
  });

  it('focus that leaves from the first focusable goes to the last one', async () => {
    render();
    await settle();
    const first = byId('head-trash');
    byId('outside').dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: first }));
    expect(document.activeElement).toBe(byId('save'));
  });

  it('when nothing inside can take focus, the panel itself takes it', async () => {
    render({ bodyInert: true, closeDisabled: true, headDisabled: true, withFooter: false });
    await settle();
    byId('outside').focus();
    expect(document.activeElement).toBe(panel());
  });

  it('bodyInert puts inert on the body only', () => {
    render({ bodyInert: true });
    expect(panel().querySelector('.modal-body')!.hasAttribute('inert')).toBe(true);
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(panel().querySelector('.modal-head')!.hasAttribute('inert')).toBe(false);
  });
});

describe('Modal — scroll lock', () => {
  it('locks <html> overflow while open and restores the previous value on close', () => {
    document.documentElement.style.overflow = 'scroll';
    render();
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount(cmp!); cmp = null;
    expect(document.documentElement.style.overflow).toBe('scroll');
  });
});

// ---- Review round 1 (T1-I1 Opus, T1-I1 Fable) ----

function tab(shift = false) {
  const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(ev);
  return ev;
}

describe('Modal — a hidden element is never a focus target (T3a clean page modal)', () => {
  it('Shift+Tab from the first focusable wraps to the last VISIBLE one, not the hidden file input', async () => {
    render({ saveDisabled: true, withHiddenFile: true });
    await settle();
    byId('head-trash').focus();
    const ev = tab(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('last'));
  });

  it('Tab from the last visible focusable wraps to the first', async () => {
    render({ saveDisabled: true, withHiddenFile: true });
    await settle();
    byId('last').focus();
    const ev = tab();
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('head-trash'));
  });

  it('focus escaping backwards from the first focusable lands on the last visible one', async () => {
    render({ saveDisabled: true, withHiddenFile: true });
    await settle();
    byId('outside').dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: byId('head-trash') }));
    expect(document.activeElement).toBe(byId('last'));
  });
});

describe('Modal — stacking (only the top modal is live)', () => {
  it('two open modals: the top one owns Escape and focus; the scroll lock survives out-of-order unmounts', async () => {
    document.documentElement.style.overflow = 'scroll';
    const pa = render();
    await settle();
    const t2 = document.createElement('div');
    document.body.appendChild(t2);
    const pb = $state({ onRequestClose: vi.fn() });
    const b = mount(Harness, { target: t2, props: pb });
    flushSync();
    await settle();
    const panels = document.querySelectorAll<HTMLElement>('section.modal-panel');
    expect(panels[1].contains(document.activeElement)).toBe(true);
    esc();
    expect(pb.onRequestClose).toHaveBeenCalledTimes(1);
    expect(pa.onRequestClose).not.toHaveBeenCalled();
    unmount(cmp!); cmp = null;                            // the bottom one first
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount(b);
    t2.remove();
    expect(document.documentElement.style.overflow).toBe('scroll');
  });
});

describe('Modal — nested level-3 inside level-2 (5d)', () => {
  it('Tab and Shift+Tab stay in the top modal; Esc closes only it', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    // The outer modal settles first, then level 3 opens over it — as in the app.
    // Mounting both at once would run the inner onMount first and leave the
    // OUTER modal on top of the stack.
    const props = $state({ inner: false, onOuterClose, onInnerClose });
    const cmp = mount(NestedHarness, { target: host, props });
    flushSync();
    await Promise.resolve();
    props.inner = true;
    flushSync();
    await Promise.resolve();
    const innerPanel = document.querySelector<HTMLElement>('section[aria-labelledby="inner-t"]')!;
    const innerClose = innerPanel.querySelector<HTMLButtonElement>('header.modal-head button[aria-label="Close"]')!;
    const innerB = document.getElementById('inner-b') as HTMLButtonElement;
    const key = (k: string, shift = false) => {
      const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, cancelable: true, bubbles: true });
      document.activeElement!.dispatchEvent(e);
      return e;
    };
    innerB.focus();
    key('Tab');
    expect(document.activeElement).toBe(innerClose);
    key('Tab', true);
    expect(document.activeElement).toBe(innerB);
    key('Escape');
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
    unmount(cmp);
    host.remove();
  });
});

describe('Modal — right placement (6c R30)', () => {
  it('centre is the default: no right modifier', () => {
    render();
    expect(backdrop().classList.contains('right')).toBe(false);
    expect(panel().classList.contains('right')).toBe(false);
  });

  it('placement="right" marks the backdrop and the panel; a backdrop click still does nothing', () => {
    const p = render({ placement: 'right' });
    expect(backdrop().classList.contains('right')).toBe(true);
    expect(panel().classList.contains('right')).toBe(true);
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  it('closeTitle is the × title only while closeDisabled; its name stays "Close"', () => {
    const p = render({ closeTitle: 'Wait for the save to finish' });
    expect(closeBtn().getAttribute('title')).toBe('Close');
    p.closeDisabled = true;
    flushSync();
    expect(closeBtn().getAttribute('title')).toBe('Wait for the save to finish');
    expect(closeBtn().getAttribute('aria-label')).toBe('Close');
    expect(closeBtn().disabled).toBe(true);
  });
});

describe('Modal — focus on <body> (Polish 3 C7 point 4)', () => {
  it('isTopModal is true only for the top panel', async () => {
    render();
    await settle();
    const t2 = document.createElement('div');
    document.body.appendChild(t2);
    const pb = $state({ onRequestClose: vi.fn() });
    const b = mount(Harness, { target: t2, props: pb });
    flushSync();
    await settle();
    const [bottom, top] = [...document.querySelectorAll<HTMLElement>('section.modal-panel')];
    expect(isTopModal(top)).toBe(true);
    expect(isTopModal(bottom)).toBe(false);
    expect(isTopModal(null)).toBe(false);
    expect(isTopModal(document.body)).toBe(false);
    unmount(b);
    t2.remove();
    expect(isTopModal(bottom)).toBe(true);
  });

  it('a key pressed with focus on body moves focus to the top panel', async () => {
    const p = render();
    await settle();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    // A Tab goes on to a control (next test); any other key stops at the panel.
    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(document.activeElement).toBe(panel());
    expect(p.onRequestClose).not.toHaveBeenCalled();
  });

  // r1 M1 (both lanes): Shift+Tab from <body> must not step out of the panel
  // and come back on the first control.
  it('Shift+Tab with focus on body lands on the last control; Tab on the first', async () => {
    render();
    await settle();
    (document.activeElement as HTMLElement).blur();
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('save'));
    (document.activeElement as HTMLElement).blur();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.body.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('head-trash'));
  });

  it('with two modals open, a key with focus on body moves focus into the top one only', async () => {
    render();
    await settle();
    const t2 = document.createElement('div');
    document.body.appendChild(t2);
    const pb = $state({ onRequestClose: vi.fn() });
    const b = mount(Harness, { target: t2, props: pb });
    flushSync();
    await settle();
    const [bottom, top] = [...document.querySelectorAll<HTMLElement>('section.modal-panel')];
    (document.activeElement as HTMLElement).blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(top);
    expect(bottom.contains(document.activeElement)).toBe(false);
    unmount(b);
    t2.remove();
  });

  // r2 Opus 1: focus left on the panel itself (the key backstop, a blocked
  // ⌘S, Escape while × is disabled) — Shift+Tab must not step out of it.
  it('Shift+Tab with focus on the panel lands on the last control', async () => {
    render();
    await settle();
    panel().focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    panel().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('save'));
  });
});
