import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveFrame from '../components/items/InteractiveFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { src: string; title: string }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  // $state() must initialize a variable — it cannot appear as a call argument
  // (`props: $state(props)` is a Svelte compile error in runes mode).
  const sprops = $state(props);
  const cmp = mount(InteractiveFrame, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector('iframe') as HTMLIFrameElement;
}

it('renders the sanitized src and title', () => {
  const f = mountFrame({ src: 'https://example.com/app', title: 'My app' });
  expect(f.getAttribute('src')).toBe('https://example.com/app');
  expect(f.getAttribute('title')).toBe('My app');
});

it('sandbox is exactly allow-scripts (no allow-same-origin)', () => {
  const f = mountFrame({ src: 'https://example.com/app', title: 'My app' });
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
});

it('sets referrerpolicy=no-referrer and omits allowfullscreen', () => {
  const f = mountFrame({ src: 'https://example.com/app', title: 'My app' });
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(f.hasAttribute('allowfullscreen')).toBe(false);
});
