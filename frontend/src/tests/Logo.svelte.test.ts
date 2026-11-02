import { it, expect } from 'vitest';
import { mount, unmount } from 'svelte';
import Logo from '../components/ui/Logo.svelte';

it('defaults to the header form (26×19.2, stroke 3.6)', () => {
  const t = document.createElement('div'); document.body.appendChild(t);
  const c = mount(Logo, { target: t });
  const svg = t.querySelector('svg')!;
  expect(svg.getAttribute('width')).toBe('26');
  expect(svg.getAttribute('height')).toBe('19.2');   // AppHeader's -4.35px nudge is calibrated on this
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 23.6');
  expect(t.querySelector('.peak-back')!.getAttribute('stroke-width')).toBe('3.6');
  unmount(c); t.remove();
});

it('form="login" renders the 28px full-square mark (stroke 4)', () => {
  const t = document.createElement('div'); document.body.appendChild(t);
  const c = mount(Logo, { target: t, props: { form: 'login' } });
  const svg = t.querySelector('svg')!;
  expect(svg.getAttribute('width')).toBe('28');
  expect(svg.getAttribute('height')).toBe('28');
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
  expect(t.querySelector('.peak-front')!.getAttribute('stroke-width')).toBe('4');
  unmount(c); t.remove();
});
