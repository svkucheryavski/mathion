import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import VersionBadges from '../components/editor/VersionBadges.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function render(state: 'created' | 'published' | 'archived', isDisabled: boolean, outlined = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(VersionBadges, { target: host, props: { state, isDisabled, outlined } });
  flushSync();
  return [...host.querySelectorAll<HTMLElement>('.vbadge')];
}

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('VersionBadges (Slice-5a §1.4, D5)', () => {
  for (const state of ['created', 'published', 'archived'] as const) {
    it(`an enabled ${state} version shows one ${state}-toned badge`, () => {
      const badges = render(state, false);
      expect(badges.map((b) => b.textContent)).toEqual([state]);
      expect(badges[0].classList.contains(state)).toBe(true);
      expect(badges[0].classList.contains('off')).toBe(false);
    });

    it(`a disabled ${state} version drops BOTH badges to the disabled tone`, () => {
      const badges = render(state, true);
      expect(badges.map((b) => b.textContent)).toEqual([state, 'disabled']);
      for (const b of badges) {
        expect(b.classList.contains('off')).toBe(true);
        expect(b.classList.contains(state)).toBe(false);
      }
    });
  }
  it('outlined (the editor heading, 5c T5): every badge carries the outline; off by default', () => {
    expect(render('created', true, true).every((b) => b.classList.contains('outlined'))).toBe(true);
    unmount(component!); component = null; host.remove();
    expect(render('created', false).some((b) => b.classList.contains('outlined'))).toBe(false);
  });
});
