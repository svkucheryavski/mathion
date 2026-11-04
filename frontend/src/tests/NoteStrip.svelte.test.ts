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

it('an info note is a status, in the info look (Review Focus 4)', () => {
  render('info');
  const strip = target.querySelector('.note-strip')!;
  expect(strip.getAttribute('role')).toBe('status');
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
