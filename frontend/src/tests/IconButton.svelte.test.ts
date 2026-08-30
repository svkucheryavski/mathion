import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import IconButton from '../components/ui/IconButton.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(IconButton, { target: host, props: props as ComponentProps<typeof IconButton> });
  flushSync();
  return host.querySelector('button') as HTMLButtonElement;
}

afterEach(() => {
  if (component) unmount(component);
  if (host?.parentNode) host.parentNode.removeChild(host);
  component = null;
});

const GLYPHS = ['pencil','duplicate','disable','enable','trash','plus','up','down','chevron','close'] as const;

describe('IconButton', () => {
  it('requires and renders a title (tooltip + a11y)', () => {
    const btn = render({ glyph: 'pencil', title: 'Edit' });
    expect(btn.getAttribute('title')).toBe('Edit');
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  // Cover the WHOLE glyph set (no consumer wires most glyphs in Slice 1, so this
  // unit test is their only guard): each renders its data-glyph hook + an <svg>.
  for (const glyph of GLYPHS) {
    it(`renders the ${glyph} glyph as an SVG via data-glyph`, () => {
      const btn = render({ glyph, title: glyph });
      expect(btn.getAttribute('data-glyph')).toBe(glyph);
      expect(btn.querySelector('svg')).not.toBeNull();
    });
  }

  it('renders distinct geometry for EVERY glyph (no shared/placeholder mark)', () => {
    // Full-set distinctness: a 2-glyph spot check would let the other 8 share one
    // arbitrary mark and still pass. Render all 10, assert every SVG body is unique.
    const marks = GLYPHS.map((glyph) => {
      const svg = render({ glyph, title: glyph }).querySelector('svg')!.innerHTML;
      unmount(component!); component = null; host.parentNode?.removeChild(host);
      return svg;
    });
    expect(new Set(marks).size).toBe(GLYPHS.length);
  });

  it('renders disabled but still present (fixed-slot alignment)', () => {
    const btn = render({ glyph: 'disable', title: 'Not allowed', disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('Not allowed');
  });

  it('does not fire onclick when disabled', () => {
    const onclick = vi.fn();
    const btn = render({ glyph: 'plus', title: 'Add', disabled: true, onclick });
    btn.click();
    expect(onclick).not.toHaveBeenCalled();
  });

  it('applies the danger class for destructive glyphs', () => {
    const btn = render({ glyph: 'trash', title: 'Delete', danger: true });
    expect(btn.classList.contains('danger')).toBe(true);
  });

  it('applies the borderless class for chevron/fold controls', () => {
    const btn = render({ glyph: 'chevron', title: 'Collapse', borderless: true });
    expect(btn.classList.contains('borderless')).toBe(true);
  });
});
