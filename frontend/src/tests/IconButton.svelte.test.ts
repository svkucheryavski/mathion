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

const GLYPHS = ['pencil','duplicate','disable','enable','trash','plus','up','down','chevron','close','back','check','chevron-right'] as const;

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
    // arbitrary mark and still pass. Render all 13, assert every SVG body is unique.
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

  // ---- Slice-5a additions (spec §1.2) ----
  it('check carries the heavier 1.9 stroke on its own element', () => {
    const svg = render({ glyph: 'check', title: 'Save' }).querySelector('svg')!;
    expect(svg.getAttribute('stroke-width')).toBe('1.6');
    expect(svg.querySelector('polyline')!.getAttribute('stroke-width')).toBe('1.9');
  });

  it('applies the round and primary classes only when asked', () => {
    const plain = render({ glyph: 'back', title: 'Back' });
    expect(plain.classList.contains('round')).toBe(false);
    expect(plain.classList.contains('primary')).toBe(false);
    unmount(component!); component = null; host.parentNode?.removeChild(host);
    const both = render({ glyph: 'plus', title: 'New', round: true, primary: true });
    expect(both.classList.contains('round')).toBe(true);
    expect(both.classList.contains('primary')).toBe(true);
  });

  it('a disabled primary button is still natively disabled (the :disabled rule wins in CSS — gate-pinned)', () => {
    const btn = render({ glyph: 'plus', title: 'New', primary: true, disabled: true });
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('primary')).toBe(true);
  });

  it('binds the <button> element', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const props = $state<{ glyph: 'pencil'; title: string; element?: HTMLButtonElement }>({ glyph: 'pencil', title: 'Edit', element: undefined });
    component = mount(IconButton, { target: host, props });
    flushSync();
    expect(props.element).toBe(host.querySelector('button'));
  });

  it('forwards id / tabindex / aria-* / onmousedown only when passed', () => {
    const bare = render({ glyph: 'chevron', title: 'Collapse' });
    for (const a of ['id', 'tabindex', 'aria-hidden', 'aria-expanded', 'aria-controls']) {
      expect(bare.hasAttribute(a)).toBe(false);
    }
    unmount(component!); component = null; host.parentNode?.removeChild(host);
    const onmousedown = vi.fn();
    const btn = render({
      glyph: 'chevron', title: 'Collapse', id: 'x1', tabindex: -1, 'aria-hidden': 'true',
      'aria-expanded': false, 'aria-controls': 'panel-1', onmousedown,
    });
    expect(btn.id).toBe('x1');
    expect(btn.getAttribute('tabindex')).toBe('-1');
    expect(btn.getAttribute('aria-hidden')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('panel-1');
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onmousedown).toHaveBeenCalledTimes(1);
  });
});
