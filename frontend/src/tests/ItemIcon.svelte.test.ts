import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ItemIcon from '../components/course/ItemIcon.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(type: string, state: 'covered' | 'current' | 'not-yet') {
  host = document.createElement('div');
  document.body.appendChild(host);
  const item = { id: 1, title: 'T', slug: 't', order: 0, type } as any;
  component = mount(ItemIcon, { target: host, props: { item, state, onclick: vi.fn() } });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

describe('ItemIcon', () => {
  const types = ['static_page', 'video', 'quiz', 'interactive_app', 'mini_project'];
  for (const type of types) {
    it(`renders an SVG mark (not emoji) for ${type}`, () => {
      const btn = render(type, 'not-yet');
      expect(btn.querySelector('svg')).not.toBeNull();          // SVG, not a text glyph
      expect(btn.getAttribute('data-type')).toBe(type);
      expect((btn.textContent ?? '').trim()).toBe('');          // no emoji text node
    });
  }
  for (const state of ['covered', 'current', 'not-yet'] as const) {
    it(`applies the ${state} state class`, () => {
      const btn = render('quiz', state);
      expect(btn.classList.contains(state)).toBe(true);
    });
  }
  it('renders a distinct mark for EVERY item type (no shared SVG)', () => {
    // Full-set distinctness: render all five types, assert every SVG body is unique
    // (a 2-type check would let quiz/interactive_app/mini_project reuse one mark).
    const marks = types.map((type) => {
      const svg = render(type, 'not-yet').querySelector('svg')!.innerHTML;
      unmount(component!); component = null; host.parentNode?.removeChild(host);
      return svg;
    });
    expect(new Set(marks).size).toBe(types.length);
  });
  it('fires onclick when the icon is activated', () => {
    const onclick = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    const item = { id: 1, title: 'T', slug: 't', order: 0, type: 'quiz' } as any;
    component = mount(ItemIcon, { target: host, props: { item, state: 'current', onclick } });
    flushSync();
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
  it('keeps title + aria-label for a11y', () => {
    const btn = render('video', 'covered');
    expect(btn.getAttribute('title')).toBe('T');
    expect(btn.getAttribute('aria-label')).toBe('T');
  });
});
