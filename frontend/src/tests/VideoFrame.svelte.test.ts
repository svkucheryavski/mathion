import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VideoFrame from '../components/items/VideoFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { src: string; title: string; fill?: boolean }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const cmp = mount(VideoFrame, { target, props });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector<HTMLElement>('.frame')!;
}

it('default: the 16:9 box, no fill modifier', () => {
  const f = mountFrame({ src: 'https://player.vimeo.com/video/1', title: 'V' });
  expect(f.classList.contains('fill')).toBe(false);
  expect(f.querySelector('iframe')!.getAttribute('src')).toBe('https://player.vimeo.com/video/1');
});

it("fill makes the frame take its parent's box", () => {
  const f = mountFrame({ src: 'https://player.vimeo.com/video/1', title: 'V', fill: true });
  expect(f.classList.contains('fill')).toBe(true);
});

it('sends only the site origin to the video host, which YouTube needs to play', () => {
  const f = mountFrame({ src: 'https://www.youtube.com/embed/x', title: 'V' });
  expect(f.querySelector('iframe')!.getAttribute('referrerpolicy')).toBe('strict-origin');
});
