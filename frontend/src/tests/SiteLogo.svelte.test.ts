import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SiteLogo from '../components/chrome/SiteLogo.svelte';
import { DEFAULT_BRANDING, setBranding } from '../lib/branding.svelte';

// Branding D4: the uploaded logo, or Mathion's drawn lockup.

let component: ReturnType<typeof mount> | null = null;
let target: HTMLDivElement;

function render(size: 'header' | 'login', image?: { src: string; width: number; height: number } | null) {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(SiteLogo, { target, props: image === undefined ? { size } : { size, image } });
  flushSync();
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  target?.remove();
  setBranding(DEFAULT_BRANDING);
});

const LOGO = { version: 'a'.repeat(16), width: 838, height: 174 };

it.each(['header', 'login'] as const)('%s: the default lockup without a logo', (size) => {
  render(size);
  expect(target.querySelector('img')).toBeNull();
  expect(target.querySelector('svg.logo')).not.toBeNull();
  expect(target.querySelector(`.wordmark-${size}`)!.textContent).toBe('Mathion');
});

it('the default lockup keeps the wordmark "Mathion" whatever the site name', () => {
  setBranding({ ...DEFAULT_BRANDING, name: 'Riverside' });
  render('header');
  expect(target.textContent).toContain('Mathion');
  expect(target.textContent).not.toContain('Riverside');
});

it.each(['header', 'login'] as const)('%s: the uploaded logo with its size and alt text', (size) => {
  setBranding({ ...DEFAULT_BRANDING, name: 'Riverside', logo: LOGO });
  render(size);
  const img = target.querySelector('img')!;
  expect(img.getAttribute('src')).toBe(`/api/branding/logo.png?v=${LOGO.version}`);
  expect(img.getAttribute('alt')).toBe('Riverside');
  expect(img.getAttribute('width')).toBe('838');
  expect(img.getAttribute('height')).toBe('174');
  expect(img.classList.contains(`logo-${size}`)).toBe(true);
  expect(target.querySelector('svg.logo')).toBeNull();
});

it('a logo that fails to load falls back to the lockup', () => {
  setBranding({ ...DEFAULT_BRANDING, logo: LOGO });
  render('header');
  target.querySelector('img')!.dispatchEvent(new Event('error'));
  flushSync();
  expect(target.querySelector('img')).toBeNull();
  expect(target.querySelector('svg.logo')).not.toBeNull();
});

it('a new logo version is tried again after a failure', () => {
  setBranding({ ...DEFAULT_BRANDING, logo: LOGO });
  render('header');
  target.querySelector('img')!.dispatchEvent(new Event('error'));
  flushSync();
  setBranding({ ...DEFAULT_BRANDING, logo: { ...LOGO, version: 'b'.repeat(16) } });
  flushSync();
  expect(target.querySelector('img')!.getAttribute('src')).toBe(`/api/branding/logo.png?v=${'b'.repeat(16)}`);
});

it('follows the store: a save in the panel shows at once (D14)', () => {
  render('header');
  expect(target.querySelector('img')).toBeNull();
  setBranding({ ...DEFAULT_BRANDING, logo: LOGO });
  flushSync();
  expect(target.querySelector('img')).not.toBeNull();
});

it('a given image shows instead of the store (the panel previews, Branding D2)', () => {
  render('login', { src: 'data:image/png;base64,AAAA', width: 40, height: 10 });
  const img = target.querySelector('img')!;
  expect(img.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  expect(img.getAttribute('width')).toBe('40');
  expect(img.classList.contains('logo-login')).toBe(true);
});

it('image: null shows the lockup even with a logo in the store', () => {
  setBranding({ ...DEFAULT_BRANDING, logo: LOGO });
  render('header', null);
  expect(target.querySelector('img')).toBeNull();
  expect(target.querySelector('svg.logo')).not.toBeNull();
});
