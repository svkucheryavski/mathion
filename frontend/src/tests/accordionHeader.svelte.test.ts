import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import AccordionHeader from '../components/editor/AccordionHeader.svelte';

// Slice-5a T5a: the header is a section heading wrapping the accessible
// toggle; the reorder arrows ALWAYS render (disabled with a reason at the
// boundary or when structure is forbidden); the chevron is a pointer-only
// convenience (D14).

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
});

function mountHeader(overrides: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(AccordionHeader, {
    target,
    props: {
      headerId: 'h1',
      panelId: 'p1',
      level: 'block',
      badge: 'B2',
      title: 'Intro',
      slug: 'intro',
      index: 2, // middle row by default
      expanded: false,
      busy: false,
      structureReason: null,
      canReorderUp: true,
      canReorderDown: true,
      onToggle: () => {},
      onMoveUp: () => {},
      onMoveDown: () => {},
      ...overrides,
    } as never,
  });
  cleanup = () => { void unmount(cmp); };
  flushSync();
  return target;
}

const up = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('[aria-label^="Move block up"], [aria-label^="Move sequence up"]')!;
const down = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('[aria-label^="Move block down"], [aria-label^="Move sequence down"]')!;
const chevron = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')!;

describe('AccordionHeader — heading + toggle', () => {
  it('a block toggle sits inside an <h3> with the accordion ARIA contract', () => {
    const t = mountHeader();
    const btn = t.querySelector<HTMLButtonElement>('#h1')!;
    expect(btn.parentElement!.tagName).toBe('H3');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('p1');
    expect(btn.getAttribute('aria-label')).toBe('Intro');
  });

  it('a sequence toggle sits inside an <h4>', () => {
    const t = mountHeader({ level: 'sequence', badge: 'S1' });
    expect(t.querySelector('#h1')!.parentElement!.tagName).toBe('H4');
    expect(t.querySelector('.acc-row')!.classList.contains('seq')).toBe(true);
  });

  it('the toggle shows the mono code badge, the title and the mono slug (aria-hidden)', () => {
    const t = mountHeader();
    const btn = t.querySelector('#h1')!;
    const code = btn.querySelector('.code')!;
    expect(code.textContent).toBe('B2');
    expect(code.classList.contains('mono')).toBe(true);
    expect(btn.querySelector('.title')!.textContent).toBe('Intro');
    const slug = btn.querySelector('.slug')!;
    expect(slug.textContent).toBe('/intro');
    expect(slug.classList.contains('mono')).toBe(true);
    expect(slug.getAttribute('aria-hidden')).toBe('true');
  });

  it('falls back to a positional placeholder when title and slug are empty', () => {
    const t = mountHeader({ title: '', slug: '' });
    expect(t.querySelector('#h1 .title')!.textContent).toBe('(block 2)');
    expect(t.querySelector('#h1')!.getAttribute('aria-label')).toBe('block 2');
    expect(t.querySelector('#h1 .slug')).toBeNull();
  });

  it('only an expanded block header carries the open (border) hook', () => {
    expect(mountHeader().querySelector('.acc-row')!.classList.contains('open')).toBe(false);
    cleanup?.();
    expect(mountHeader({ expanded: true }).querySelector('.acc-row')!.classList.contains('open')).toBe(true);
  });
});

describe('AccordionHeader — reorder arrows (always rendered)', () => {
  it('a middle row has both arrows enabled with plain titles and named labels', () => {
    const t = mountHeader();
    expect(up(t).disabled).toBe(false);
    expect(up(t).title).toBe('Move up');
    expect(up(t).getAttribute('aria-label')).toBe('Move block up: Intro');
    expect(down(t).disabled).toBe(false);
    expect(down(t).title).toBe('Move down');
    expect(down(t).getAttribute('aria-label')).toBe('Move block down: Intro');
  });

  it('the first row keeps a disabled up arrow titled "already first"', () => {
    const t = mountHeader({ canReorderUp: false });
    expect(up(t).disabled).toBe(true);
    expect(up(t).title).toBe('Move up — already first');
    expect(down(t).disabled).toBe(false);
  });

  it('the last row keeps a disabled down arrow titled "already last"', () => {
    const t = mountHeader({ canReorderDown: false });
    expect(down(t).disabled).toBe(true);
    expect(down(t).title).toBe('Move down — already last');
    expect(up(t).disabled).toBe(false);
  });

  it('a structure reason disables both arrows and wins over the boundary title', () => {
    const reason = 'Only a created version can change its structure';
    const t = mountHeader({ structureReason: reason, canReorderUp: false });
    expect(up(t).disabled).toBe(true);
    expect(up(t).title).toBe(reason);
    expect(down(t).disabled).toBe(true);
    expect(down(t).title).toBe(reason);
  });

  it('busy disables both arrows; titles stay the normal ones', () => {
    const t = mountHeader({ busy: true });
    expect(up(t).disabled).toBe(true);
    expect(up(t).title).toBe('Move up');
    expect(down(t).disabled).toBe(true);
  });

  it('clicking an enabled arrow calls its handler', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const t = mountHeader({ onMoveUp, onMoveDown });
    up(t).click();
    down(t).click();
    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
  });
});

describe('AccordionHeader — chevron (D14) and extra', () => {
  it('the chevron is out of the tab order, hidden from AT, and swaps glyph + title', () => {
    let t = mountHeader();
    expect(chevron(t).tabIndex).toBe(-1);
    expect(chevron(t).dataset.glyph).toBe('chevron-right');
    expect(chevron(t).title).toBe('Expand');
    cleanup?.();
    t = mountHeader({ expanded: true });
    expect(chevron(t).dataset.glyph).toBe('chevron');
    expect(chevron(t).title).toBe('Collapse');
  });

  it('the chevron toggles, and its mousedown never takes focus', () => {
    const onToggle = vi.fn();
    const t = mountHeader({ onToggle });
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    chevron(t).dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    chevron(t).click();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders `extra` between the down arrow and the chevron', () => {
    const extra = createRawSnippet(() => ({ render: () => '<button class="probe">+</button>' }));
    const t = mountHeader({ extra });
    const glyphs = [...t.querySelectorAll('.actions > button')].map((b) => (b as HTMLElement).dataset.glyph ?? b.className);
    expect(glyphs).toEqual(['up', 'down', 'probe', 'chevron-right']);
  });
});
