import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import LoadingPlaceholder from '../components/ui/LoadingPlaceholder.svelte';

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) unmount(component); document.body.removeChild(target); });

describe('LoadingPlaceholder', () => {
  it('renders default "Loading…" label', () => {
    component = mount(LoadingPlaceholder, { target, props: {} });
    flushSync();
    expect(target.querySelector('.loading-placeholder')?.textContent?.trim()).toBe('Loading…');
  });
  it('renders custom label', () => {
    component = mount(LoadingPlaceholder, { target, props: { label: 'Fetching…' } });
    flushSync();
    expect(target.querySelector('.loading-placeholder')?.textContent?.trim()).toBe('Fetching…');
  });
});
