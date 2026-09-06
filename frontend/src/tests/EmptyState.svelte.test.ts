import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
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
});
