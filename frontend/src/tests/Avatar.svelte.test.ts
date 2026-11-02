import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Avatar from '../components/ui/Avatar.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

describe('Avatar (D7)', () => {
  it('is the drawn silhouette: an inline SVG, aria-hidden, never an <img>', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(Avatar, { target: host });
    flushSync();
    const el = host.querySelector('.avatar') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('img')).toBeNull();
    expect(el.querySelector('svg circle')?.getAttribute('r')).toBe('2.7');
    expect(el.querySelector('svg path')?.getAttribute('d')).toBe('M2.6 14.4c.5-3 2.7-4.6 5.4-4.6s4.9 1.6 5.4 4.6z');
  });
});
