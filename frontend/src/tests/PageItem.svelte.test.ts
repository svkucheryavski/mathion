import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

// PageItem starts a coverage tracker on mount; neither it nor the store matters here.
vi.mock('../lib/coverage.svelte', () => ({
  createCoverageTracker: () => ({ start: vi.fn(), stop: vi.fn(async () => {}), markCovered: vi.fn(async () => {}) }),
}));
vi.mock('../stores/currentCourse.svelte', () => ({ markItemCovered: vi.fn() }));

import PageItem from '../components/items/PageItem.svelte';
import type { StaticPageItem } from '../lib/types';

function makeItem(content_html: string): StaticPageItem {
  return { id: 1, sequence_id: 1, title: 'A page', slug: 'a-page', order: 0, type: 'static_page', content_md: '', content_html };
}

let target: HTMLElement;
let component: ReturnType<typeof mount> | null = null;
beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target); });
afterEach(() => { if (component) { unmount(component); component = null; } target.remove(); });

describe('PageItem authored content (Polish 2)', () => {
  it('D51: the content renders in the page-scale prose box', () => {
    component = mount(PageItem, { target, props: { item: makeItem('<p>x</p>') } });
    flushSync();
    const box = target.querySelector('.page-item .content')!;
    expect(box.classList.contains('prose')).toBe(true);
    expect(box.classList.contains('compact')).toBe(false);
  });

  it('D58: an external link opens in a new tab; a Mathion page link stays', () => {
    const html = `<p><a href="https://example.org/x">ext</a> <a href="${location.origin}/courses/x">page</a></p>`;
    component = mount(PageItem, { target, props: { item: makeItem(html) } });
    flushSync();
    const ext = target.querySelector('a[href="https://example.org/x"]')!;
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');
    const page = target.querySelector(`a[href="${location.origin}/courses/x"]`)!;
    expect(page.hasAttribute('target')).toBe(false);
  });
});
