import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SwitchHarness from './support/SwitchHarness.svelte';

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount> | undefined;

function render(props: Record<string, unknown> = {}): HTMLButtonElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  cmp = mount(SwitchHarness, { target: host, props });
  flushSync();
  return host.querySelector('button[role="switch"]') as HTMLButtonElement;
}
const value = () => host.querySelector('[data-testid="value"]')!.textContent;
const submits = () => host.querySelector('[data-testid="submits"]')!.textContent;

afterEach(() => {
  if (cmp) unmount(cmp);
  cmp = undefined;
  host.remove();
});

describe('Switch (R16)', () => {
  // P6: Space and Enter come from the platform because it is a native button;
  // jsdom does not synthesise them, so the browser pass checks Space.
  it('is a native type=button with role=switch; aria-checked and the on class follow the value', () => {
    const sw = render();
    expect(sw.tagName).toBe('BUTTON');
    expect(sw.type).toBe('button');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.classList.contains('on')).toBe(false);
    sw.click();
    flushSync();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.classList.contains('on')).toBe(true);
    expect(value()).toBe('true');
  });

  it('a click never submits the form it sits in', () => {
    const sw = render();
    sw.click();
    sw.click();
    flushSync();
    expect(value()).toBe('false');
    expect(submits()).toBe('0');
  });

  it('a click on its label toggles it', () => {
    render();
    host.querySelector('label')!.click();
    flushSync();
    expect(value()).toBe('true');
  });

  it('the help line is its description', () => {
    const sw = render();
    expect(sw.getAttribute('aria-describedby')).toBe('sw-help');
  });

  it('disabled ignores clicks and names its reason', () => {
    const sw = render({ disabled: true, title: 'Locked once the run is published' });
    sw.click();
    flushSync();
    expect(sw.disabled).toBe(true);
    expect(sw.title).toBe('Locked once the run is published');
    expect(value()).toBe('false');
  });

  it('frozen keeps focus and its look but ignores clicks (R19)', () => {
    const sw = render({ frozen: true });
    sw.focus();
    sw.click();
    flushSync();
    expect(value()).toBe('false');
    expect(sw.disabled).toBe(false);
    expect(sw.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(sw);
  });

  it('onchange gets the new value after the flip, once per click (R42)', () => {
    const calls: boolean[] = [];
    const sw = render({ onchange: (v: boolean) => calls.push(v) });
    sw.click();
    flushSync();
    expect(calls).toEqual([true]);
    expect(value()).toBe('true');
    sw.click();
    flushSync();
    expect(calls).toEqual([true, false]);
  });

  it('a disabled or frozen switch calls no onchange', () => {
    const calls: boolean[] = [];
    const off = render({ disabled: true, onchange: (v: boolean) => calls.push(v) });
    off.click();
    flushSync();
    unmount(cmp!);
    cmp = undefined;
    host.remove();
    const frozen = render({ frozen: true, onchange: (v: boolean) => calls.push(v) });
    frozen.click();
    flushSync();
    expect(calls).toEqual([]);
  });
});
