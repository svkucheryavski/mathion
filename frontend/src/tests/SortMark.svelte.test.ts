import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SortMark from '../components/ui/SortMark.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

function render(dir: 'asc' | 'desc'): SVGElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(SortMark, { target: host, props: { dir } });
  flushSync();
  return host.querySelector('svg.sort-mark') as SVGElement;
}

describe('SortMark (P6)', () => {
  it('asc points up, desc points down; decorative', () => {
    const up = render('asc');
    expect(up.getAttribute('aria-hidden')).toBe('true');
    expect(up.getAttribute('data-dir')).toBe('asc');
    expect(up.querySelector('polyline')?.getAttribute('points')).toBe('2,6.5 5,3.5 8,6.5');
    unmount(component!); component = null; host.remove();
    const down = render('desc');
    expect(down.querySelector('polyline')?.getAttribute('points')).toBe('2,3.5 5,6.5 8,3.5');
  });
  it('carries no text, so it never changes a header button name', () => {
    expect(render('asc').textContent).toBe('');
  });
});
