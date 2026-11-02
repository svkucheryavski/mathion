import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import FilterPills from '../components/ui/FilterPills.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); });

function render(value = 'a') {
  host = document.createElement('div');
  document.body.appendChild(host);
  const onchange = vi.fn();
  component = mount(FilterPills, {
    target: host,
    props: {
      label: 'Filter by status',
      options: [{ key: 'a', label: 'Active', count: 2 }, { key: 'all', label: 'All' }],
      value, onchange,
    },
  });
  flushSync();
  return { onchange, buttons: Array.from(host.querySelectorAll('button')) };
}

describe('FilterPills (handoff §4 filter pills)', () => {
  it('a labelled group of toggle buttons; the count is mono', () => {
    const { buttons } = render();
    const group = host.querySelector('.filter-pills') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Filter by status');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Active (2)', 'All']);
    expect(buttons[0]!.querySelector('.fp-n')?.textContent).toBe('(2)');
  });

  it('aria-pressed follows value; a click reports the key', () => {
    const { buttons, onchange } = render('all');
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    buttons[0]!.click();
    expect(onchange).toHaveBeenCalledWith('a');
  });
});
