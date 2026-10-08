import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AccordionHeader, { type HeaderMode } from '../components/editor/AccordionHeader.svelte';
import { createDirtyRegistry, DIRTY_REGISTRY_KEY, type DirtyRegistry } from '../lib/dirtyRegistry.svelte';
import { ApiError } from '../lib/api';
import { toasts, clearToasts } from '../stores/toasts.svelte';

// Slice-5c T2: the header shows the title only (D5); its controls depend on
// where it sits relative to the focus (D4) and on the version's permissions;
// the open node carries ✎ (inline title, D8) and its own trash (D6). The
// chevron stays a pointer-only convenience (5a D14).

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
let registry: DirtyRegistry;
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); clearToasts(); vi.restoreAllMocks(); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  registry = createDirtyRegistry();
  const props = $state({
    headerId: 'h', panelId: 'p', level: 'sequence' as 'block' | 'sequence', mode: 'open-focus' as HeaderMode, title: 'Linear combinations' as string | null,
    slug: 'linear-combinations' as string | null, index: 1, expanded: true, busy: false, canStructure: true, canEditTitle: true,
    canReorderUp: true, canReorderDown: true, deleteBlockedReason: null as string | null,
    onToggle: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(), onDelete: vi.fn(),
    onRename: vi.fn((_t: string) => Promise.resolve()), ...over,
  });
  cmp = mount(AccordionHeader, { target, props, context: new Map([[DIRTY_REGISTRY_KEY, registry]]) });
  flushSync();
  return props;
}
const btn = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const pencil = () => btn('Edit the sequence title');
const input = () => target.querySelector<HTMLInputElement>('input.title-input');
const up = () => btn('Move sequence up: Linear combinations');
const down = () => btn('Move sequence down: Linear combinations');
const trash = () => btn('Delete sequence Linear combinations');
function type(v: string) { const el = input()!; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); }
function key(k: string) { input()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); flushSync(); }

// User, 2026-10-08: a block's title is numbered "1. Title"; sequences and items are not.
describe('AccordionHeader — block number', () => {
  const blk = { level: 'block' as const, title: 'Vectors', slug: 'vectors', index: 3 };
  for (const mode of ['row-focus', 'row-outside', 'open-focus', 'open-parent'] as HeaderMode[]) {
    it(`a block header shows "3." before the title (${mode})`, () => {
      render({ ...blk, mode });
      const num = target.querySelector('.num')!;
      expect(num.textContent).toBe('3.');
      expect((num.compareDocumentPosition(target.querySelector('.title')!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
      // The accessible name stays the title (the number is the list position).
      expect(target.querySelector('button.toggle')!.getAttribute('aria-label')).toBe('Vectors');
    });
  }
  it('the number stays while the block title is being edited', async () => {
    render(blk);
    btn('Edit the block title')!.click(); await settle();
    expect(input()).not.toBeNull();
    expect(target.querySelector('.num')!.textContent).toBe('3.');
    // Outside the aria-labelled toggle now: hidden, so "3." isn't read before the field (review r1).
    expect(target.querySelector('.num')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('a sequence header has no number', () => {
    render({ index: 2 });
    expect(target.querySelector('.num')).toBeNull();
    expect(target.querySelector('.acc-row')!.textContent).not.toContain('2.');
  });
});

describe('AccordionHeader — title only, no badge or slug (D5)', () => {
  it('shows the title; no B/S code, no /slug', () => {
    render();
    expect(target.querySelector('.title')!.textContent).toBe('Linear combinations');
    expect(target.querySelector('.code')).toBeNull();
    expect(target.querySelector('.slug')).toBeNull();
    expect(target.textContent).not.toContain('/linear-combinations');
  });
  it('keeps the heading toggle and its ARIA contract (block → h3, sequence → h4)', () => {
    render({ level: 'block', title: 'Vectors' });
    const t = target.querySelector<HTMLButtonElement>('#h')!;
    expect(t.parentElement!.tagName).toBe('H3');
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(t.getAttribute('aria-controls')).toBe('p');
    expect(t.getAttribute('aria-label')).toBe('Vectors');
  });
  it('the toggle calls onToggle; the chevron is pointer-only (tabindex -1, aria-hidden)', () => {
    const p = render({ level: 'sequence' });
    expect(target.querySelector('#h')!.parentElement!.tagName).toBe('H4');
    target.querySelector<HTMLButtonElement>('#h')!.click();
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    const chev = target.querySelector<HTMLButtonElement>('button[data-glyph="chevron"]')!;
    expect(chev.getAttribute('tabindex')).toBe('-1');
    expect(chev.getAttribute('aria-hidden')).toBe('true');
    chev.click();
    expect(p.onToggle).toHaveBeenCalledTimes(2);
  });
  it('the chevron never takes focus on mousedown (5a D14) and swaps Collapse / Expand', () => {
    const p = render();
    const chev = () => target.querySelector<HTMLButtonElement>('button[data-glyph^="chevron"]')!;
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    chev().dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    expect(chev().title).toBe('Collapse');
    p.expanded = false; p.mode = 'row-focus'; flushSync();
    expect(chev().title).toBe('Expand');
    expect(chev().getAttribute('data-glyph')).toBe('chevron-right');
  });
  it('without title and slug: "(sequence 1)" visible, "sequence 1" as the name', () => {
    render({ title: null, slug: null });
    expect(target.querySelector('.title')!.textContent).toBe('(sequence 1)');
    expect(target.querySelector('#h')!.getAttribute('aria-label')).toBe('sequence 1');
  });
});

describe('AccordionHeader — controls per mode (D4, D6)', () => {
  it('open-focus: ✎ ↑ ↓ trash and the chevron, in that order', () => {
    render();
    const glyphs = [...target.querySelectorAll('.actions button')].map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['pencil', 'up', 'down', 'trash', 'chevron']);
  });
  it('row-focus: ↑ ↓ and the chevron only (no ✎, no trash)', () => {
    render({ mode: 'row-focus', expanded: false });
    const glyphs = [...target.querySelectorAll('.actions button')].map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['up', 'down', 'chevron-right']);
  });
  it('row-outside: the title only, no buttons besides the toggle', () => {
    render({ mode: 'row-outside', expanded: false });
    expect(target.querySelectorAll('.actions button').length).toBe(0);
  });
  it('open-parent: the title and the chevron only', () => {
    render({ mode: 'open-parent' });
    const glyphs = [...target.querySelectorAll('.actions button')].map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['chevron']);
  });
  it('published (canStructure false, canEditTitle true): ✎ only', () => {
    render({ canStructure: false });
    expect(pencil()).not.toBeNull();
    expect(up()).toBeNull();
    expect(down()).toBeNull();
    expect(trash()).toBeNull();
  });
  it('archived / disabled (both false): nothing but the chevron', () => {
    render({ canStructure: false, canEditTitle: false });
    const glyphs = [...target.querySelectorAll('.actions button')].map((b) => b.getAttribute('data-glyph'));
    expect(glyphs).toEqual(['chevron']);
  });
  it('a blocked delete stays visible, disabled, with the reason as its title', () => {
    render({ deleteBlockedReason: 'Remove its items first' });
    expect(trash()!.disabled).toBe(true);
    expect(trash()!.title).toBe('Remove its items first');
  });
  it('an allowed delete: titled "Delete this sequence"; the trash calls onDelete', () => {
    const p = render();
    expect(trash()!.title).toBe('Delete this sequence');
    trash()!.click();
    expect(p.onDelete).toHaveBeenCalledTimes(1);
  });
  it('boundary arrows stay rendered, disabled with "already first/last"', () => {
    render({ canReorderUp: false, canReorderDown: false });
    expect(up()!.disabled).toBe(true);
    expect(up()!.title).toBe('Move up — already first');
    expect(down()!.disabled).toBe(true);
    expect(down()!.title).toBe('Move down — already last');
  });
  it('arrows call onMoveUp / onMoveDown', () => {
    const p = render();
    up()!.click();
    down()!.click();
    expect(p.onMoveUp).toHaveBeenCalledTimes(1);
    expect(p.onMoveDown).toHaveBeenCalledTimes(1);
  });
  it('busy disables ✎, the arrows and the trash', () => {
    render({ busy: true });
    expect(pencil()!.disabled).toBe(true);
    expect(up()!.disabled).toBe(true);
    expect(down()!.disabled).toBe(true);
    expect(trash()!.disabled).toBe(true);
  });
});

describe('AccordionHeader — inline title (D8)', () => {
  it('✎ turns the title into a focused field holding the title; the toggle leaves', async () => {
    render();
    pencil()!.click(); await settle();
    expect(input()!.value).toBe('Linear combinations');
    expect(input()!.getAttribute('aria-label')).toBe('Sequence title');
    expect(document.activeElement).toBe(input());
    expect(target.querySelector('#h')).toBeNull();
  });
  it('Enter saves through onRename with the trimmed title, then closes and refocuses ✎', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('  Combinations  '); key('Enter'); await settle();
    expect(p.onRename).toHaveBeenCalledWith('Combinations');
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(pencil());
  });
  it('✓ saves like Enter', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('Combinations');
    btn('Save the sequence title')!.click(); await settle();
    expect(p.onRename).toHaveBeenCalledWith('Combinations');
    expect(input()).toBeNull();
  });
  it('Esc cancels without a request and refocuses ✎', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('X'); key('Escape'); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
    expect(document.activeElement).toBe(pencil());
  });
  it('✕ cancels like Esc', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('X');
    btn('Cancel editing the sequence title')!.click(); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });
  it('Esc does not bubble (an enclosing handler must not see it)', async () => {
    render();
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    pencil()!.click(); await settle();
    key('Escape');
    window.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });
  it('an empty title is refused in place', async () => {
    const p = render();
    pencil()!.click(); await settle();
    type('   '); key('Enter'); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(target.querySelector('.err')!.textContent).toBe('Title is required');
    expect(input()!.getAttribute('aria-invalid')).toBe('true');
  });
  it('an unchanged title closes without a request', async () => {
    const p = render();
    pencil()!.click(); await settle();
    key('Enter'); await settle();
    expect(p.onRename).not.toHaveBeenCalled();
    expect(input()).toBeNull();
  });
  it('error keeps the field open with the message and the draft; typing clears it', async () => {
    render({ onRename: vi.fn(() => Promise.reject(new Error('nope'))) });
    pencil()!.click(); await settle();
    type('New'); key('Enter'); await settle();
    expect(input()!.value).toBe('New');
    expect(target.querySelector('.err')!.textContent).toBe('Save failed');
    expect(document.activeElement).toBe(input());
    type('Newer');
    expect(target.querySelector('.err')).toBeNull();
  });
  it('an API error shows its message', async () => {
    render({ onRename: vi.fn(() => Promise.reject(new ApiError(409, 'Title already taken'))) });
    pencil()!.click(); await settle();
    type('New'); key('Enter'); await settle();
    expect(target.querySelector('.err')!.textContent).toBe('Title already taken');
  });
  it('while saving, a second Enter sends nothing and the field is read-only', async () => {
    let release!: () => void;
    const p = render({ onRename: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    pencil()!.click(); await settle();
    type('New'); key('Enter'); await settle();
    expect(input()!.readOnly).toBe(true);
    key('Enter'); await settle();
    expect(p.onRename).toHaveBeenCalledTimes(1);
    release(); await settle();
    expect(input()).toBeNull();
  });
  it('rename is guard-dirty only when the draft differs; discardAll closes it', async () => {
    render();
    pencil()!.click(); await settle();
    expect(registry.isAnyDirty()).toBe(false);
    type('Changed');
    expect(registry.isAnyDirty()).toBe(true);
    registry.discardAll(); flushSync();
    expect(input()).toBeNull();
  });
  it('read-only flip closes the field', async () => {
    const p = render();
    pencil()!.click(); await settle();
    p.canEditTitle = false; flushSync();
    expect(input()).toBeNull();
  });
  it('leaving the focus closes the field', async () => {
    const p = render();
    pencil()!.click(); await settle();
    p.mode = 'open-parent'; flushSync();
    expect(input()).toBeNull();
  });
  it('a failure after the field closed (e.g. Back mid-save) toasts instead', async () => {
    let reject!: (e: unknown) => void;
    const p = render({ onRename: vi.fn(() => new Promise<void>((_r, j) => { reject = j; })) });
    pencil()!.click(); await settle();
    type('New'); key('Enter'); await settle();
    p.mode = 'open-parent'; flushSync();
    reject(new Error('x')); await settle();
    expect(toasts.list.map((t) => t.message)).toContain('Save failed');
  });
});
