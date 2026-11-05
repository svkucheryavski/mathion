import { it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Segmented from '../components/ui/Segmented.svelte';

let target: HTMLDivElement;
let cmp: ReturnType<typeof mount> | null = null;
afterEach(() => { if (cmp) unmount(cmp); cmp = null; target?.remove(); });

const OPTIONS = [{ value: 1, label: '1 day' }, { value: 7, label: '7 days' }, { value: 30, label: '30 days' }];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(over: Record<string, any> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  const state = $state({ value: 7 as number });
  cmp = mount(Segmented, {
    target,
    props: {
      options: OPTIONS, name: 'duration', label: 'Stay signed in for',
      get value() { return state.value; }, set value(v: number) { state.value = v; },
      ...over,
    },
  });
  flushSync();
  return state;
}
const segments = () => [...target.querySelectorAll<HTMLLabelElement>('.segment')];
const radios = () => [...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')];

it('is a named radiogroup with one radio per option, in order', () => {
  render();
  const group = target.querySelector('[role="radiogroup"]')!;
  expect(group.getAttribute('aria-label')).toBe('Stay signed in for');
  expect(segments().map((s) => s.textContent!.trim())).toEqual(['1 day', '7 days', '30 days']);
  expect(radios().map((r) => r.name)).toEqual(['duration', 'duration', 'duration']);
});

it('marks the bound value selected and checked', () => {
  render();
  expect(segments().map((s) => s.classList.contains('selected'))).toEqual([false, true, false]);
  expect(radios().map((r) => r.checked)).toEqual([false, true, false]);
});

it('picking a segment sets the bound value, typed as the option value', () => {
  const state = render();
  radios()[2].click();
  flushSync();
  expect(state.value).toBe(30);
  expect(segments().map((s) => s.classList.contains('selected'))).toEqual([false, false, true]);
});

it('disabled disables every radio and keeps the value', () => {
  const state = render({ disabled: true });
  expect(radios().every((r) => r.disabled)).toBe(true);
  radios()[0].click();
  flushSync();
  expect(state.value).toBe(7);
});

it('onchange gets the picked value', () => {
  const seen: number[] = [];
  render({ onchange: (v: number) => seen.push(v) });
  radios()[0].click();
  flushSync();
  expect(seen).toEqual([1]);
});
