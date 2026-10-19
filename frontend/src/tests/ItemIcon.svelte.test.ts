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
  for (const state of ['covered', 'current', 'not-yet'] as const) {
    it(`forwards the ${state} state to the nested ItemMark, not just the button`, () => {
      // T6 moves the visual state box off the button onto the child ItemMark,
      // so the button's own state class no longer proves anything is rendered
      // in that state. Without this, an implementer could write
      // `<ItemMark type={item.type} />` — dropping `state=` — pass every
      // button-state assertion above, and silently paint every mark as the
      // default `not-yet`.
      const btn = render('quiz', state);
      const mark = btn.querySelector('.item-mark');
      expect(mark).not.toBeNull();
      expect(mark!.classList.contains(state)).toBe(true);
    });
  }
  it('reduces the button to a bare wrapper — the 22px box lives on ItemMark', () => {
    // Guards the double-ring defect: if `.icon` kept its own 22px bordered box
    // it would nest one bordered square inside another. The box is CSS, which
    // jsdom cannot see, so what is checkable here is the STRUCTURE the fix
    // depends on — the button's only element child is the ItemMark span, and
    // the SVG now sits inside that span rather than directly in the button.
    const btn = render('video', 'current');
    expect(btn.children.length).toBe(1);
    const mark = btn.firstElementChild!;
    expect(mark.classList.contains('item-mark')).toBe(true);
    expect(mark.querySelector('svg')).not.toBeNull();
  });
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
  it('carries NO inline style attribute on the button or the mark', () => {
    // codex-r1-C1: an inline `style` re-creating the 22px bordered box on the
    // button restores the double ring while the built-CSS gate stays green,
    // because Svelte emits inline styles into the JS bundle rather than the CSS
    // file the gate grades. Both roots are pinned, here and in ItemMark's tests.
    const btn = render('quiz', 'covered');
    expect(btn.hasAttribute('style')).toBe(false);
    expect(btn.firstElementChild!.hasAttribute('style')).toBe(false);
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

  // D62: ItemIcon renders only in the player's strip, so its mark takes the
  // strip look.
  it('puts its ItemMark in strip mode', () => {
    const btn = render('quiz', 'current');
    expect(btn.querySelector('.item-mark')!.classList.contains('in-strip')).toBe(true);
  });
});
