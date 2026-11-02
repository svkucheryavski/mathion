import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import InteractiveFrame from '../components/items/InteractiveFrame.svelte';

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

function mountFrame(props: { scriptSource: string; title: string; height?: number }) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const sprops = $state(props);
  const cmp = mount(InteractiveFrame, { target, props: sprops });
  cleanup = () => unmount(cmp);
  flushSync();
  return target.querySelector('iframe') as HTMLIFrameElement;
}

it('inlines the source into a srcdoc with #app-root and the CSP', () => {
  const f = mountFrame({ scriptSource: "console.log('hi')", title: 'My app' });
  const doc = f.getAttribute('srcdoc') ?? '';
  expect(doc).toContain('id="app-root"');
  expect(doc).toContain("console.log('hi')");
  expect(doc).toContain("connect-src 'none'");
  expect(f.getAttribute('title')).toBe('My app');
  expect(f.hasAttribute('src')).toBe(false);   // never a URL
  expect(f.parentElement?.classList.contains('frame')).toBe(true);  // fixed-height (600px) wrapper present; exact px is manual-smoke (jsdom has no layout)
});

it('sandbox is exactly allow-scripts (no allow-same-origin)', () => {
  const f = mountFrame({ scriptSource: 'x', title: 't' });
  expect(f.getAttribute('sandbox')).toBe('allow-scripts');
});

it('sets referrerpolicy=no-referrer and omits allowfullscreen', () => {
  const f = mountFrame({ scriptSource: 'x', title: 't' });
  expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(f.hasAttribute('allowfullscreen')).toBe(false);
});

it('height: the fixed modifier and --frame-h; the default has neither (Slice-5b D14)', () => {
  const sized = mountFrame({ scriptSource: 'x', title: 't', height: 360 }).parentElement!;
  expect(sized.classList.contains('fixed')).toBe(true);
  expect(sized.style.getPropertyValue('--frame-h')).toBe('360px');
  cleanup?.(); cleanup = null;
  const plain = mountFrame({ scriptSource: 'x', title: 't' }).parentElement!;
  expect(plain.classList.contains('fixed')).toBe(false);
});
