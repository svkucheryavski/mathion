import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Toaster from '../components/chrome/Toaster.svelte';

let host: HTMLDivElement;
let cmp: ReturnType<typeof mount>;

afterEach(() => {
  if (cmp) unmount(cmp);
  host?.remove();
});

describe('Toaster aria-live', () => {
  it('TT1: Toaster container renders with aria-live="polite"', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    cmp = mount(Toaster, { target: host });
    flushSync();
    const toaster = host.querySelector('.toaster') as HTMLElement;
    expect(toaster).toBeTruthy();
    expect(toaster.getAttribute('aria-live')).toBe('polite');
  });
});
