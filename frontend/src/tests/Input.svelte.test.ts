import { it, expect } from 'vitest';
import { mount, unmount } from 'svelte';
import Input from '../components/ui/Input.svelte';

it('mono adds the mono class; default does not', () => {
  const t = document.createElement('div'); document.body.appendChild(t);
  const c = mount(Input, { target: t, props: { mono: true } });
  expect(t.querySelector('input')!.classList.contains('mono')).toBe(true);
  unmount(c); t.remove();
  const t2 = document.createElement('div'); document.body.appendChild(t2);
  const c2 = mount(Input, { target: t2 });
  expect(t2.querySelector('input')!.classList.contains('mono')).toBe(false);
  unmount(c2); t2.remove();
});
