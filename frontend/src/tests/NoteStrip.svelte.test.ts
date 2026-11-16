import { it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import NoteStrip from '../components/superuser/NoteStrip.svelte';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); });

function render(tone: 'info' | 'error') {
  target = document.createElement('div');
  document.body.appendChild(target);
  const onClose = vi.fn();
  const children = createRawSnippet(() => ({ render: () => '<span>Anna Holm is now the admin of Statistics 101.</span>' }));
  cmp = mount(NoteStrip, { target, props: { tone, onClose, children } });
  flushSync();
  return onClose;
}

it('an info note has no role: its caller\'s always-mounted status region announces it', () => {
  render('info');
  const strip = target.querySelector('.note-strip')!;
  expect(strip.hasAttribute('role')).toBe(false);
  expect(strip.classList.contains('info')).toBe(true);
  expect(strip.textContent).toContain('Anna Holm is now the admin of Statistics 101.');
});

it('an error note is an alert, in the error look', () => {
  render('error');
  const strip = target.querySelector('.note-strip')!;
  expect(strip.getAttribute('role')).toBe('alert');
  expect(strip.classList.contains('error')).toBe(true);
});

it('× closes it', () => {
  const onClose = render('info');
  const x = target.querySelector<HTMLButtonElement>('button[data-glyph="close"]')!;
  expect(x.getAttribute('title')).toBe('Close');
  x.click();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('with no onClose there is no close button (Set up D8)', () => {
  target = document.createElement('div');
  document.body.appendChild(target);
  const children = createRawSnippet(() => ({ render: () => '<span>Statistics 101 is created.</span>' }));
  cmp = mount(NoteStrip, { target, props: { tone: 'info', children } });
  flushSync();
  expect(target.querySelector('.note-strip')!.textContent).toContain('Statistics 101 is created.');
  expect(target.querySelector('button')).toBeNull();
});
