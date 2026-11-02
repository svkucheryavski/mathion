import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, createRawSnippet } from 'svelte';
import EmptyState from '../components/ui/EmptyState.svelte';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (host?.parentNode) host.parentNode.removeChild(host);
});

describe('EmptyState (Slice-4 §1.2)', () => {
  it('renders the title as the only content of the card', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    component = mount(EmptyState, { target: host, props: { title: 'Nothing here yet.' } });
    flushSync();

    const root = host.querySelector('.empty-state');
    expect(root).not.toBeNull();
    const title = root!.querySelector('p.title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Nothing here yet.');
    // Title-only by decision D2: no hint, icon or action until a consumer needs one.
    expect(root!.children.length).toBe(1);
    expect(root!.textContent?.trim()).toBe('Nothing here yet.');
  });

  it('renders the optional icon tile, hint and action in order (Slice-5a, ref 1353-1360)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const action = createRawSnippet(() => ({ render: () => '<button type="button" class="probe">+ New version</button>' }));
    component = mount(EmptyState, {
      target: host,
      props: { title: 'No versions yet', icon: 'list', hint: 'A version holds the blocks.', action },
    });
    flushSync();
    const root = host.querySelector('.empty-state')!;
    const kids = [...root.children].map((c) => c.className.split(' ')[0]);
    expect(kids).toEqual(['tile', 'title', 'hint', 'action']);
    expect(root.querySelector('.tile')!.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelectorAll('.tile svg line').length).toBe(3);
    expect(root.querySelector('.hint')!.textContent).toBe('A version holds the blocks.');
    expect(root.querySelector('.action button.probe')).not.toBeNull();
  });
});
