import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VideoFrame from '../components/items/VideoFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { src: string; title: string; height?: number }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(VideoFrame, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector<HTMLElement>('.frame')!;
}

it('default: the 16:9 box, no fixed modifier, no height variable', () => {
  const f = mountFrame({ src: 'https://player.vimeo.com/video/1', title: 'V' });
  expect(f.classList.contains('fixed')).toBe(false);
  expect(f.style.getPropertyValue('--frame-h')).toBe('');
  expect(f.querySelector('iframe')!.getAttribute('src')).toBe('https://player.vimeo.com/video/1');
});

it('height: the fixed modifier and --frame-h (Slice-5b D13)', () => {
  const f = mountFrame({ src: 'https://player.vimeo.com/video/1', title: 'V', height: 296 });
  expect(f.classList.contains('fixed')).toBe(true);
  expect(f.style.getPropertyValue('--frame-h')).toBe('296px');
});
