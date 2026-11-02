import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TeachingCrumbs from '../components/runs/TeachingCrumbs.svelte';
import * as router from '../lib/router.svelte';
import { expectRoutesInApp } from './support/routeClickProbe';

let host: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;
afterEach(() => { if (component) unmount(component); component = null; host?.remove(); vi.restoreAllMocks(); });

function render(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  component = mount(TeachingCrumbs, { target: host, props: props as never });
  flushSync();
  return host.querySelector('nav') as HTMLElement;
}

describe('TeachingCrumbs (spec §The breadcrumb)', () => {
  it('on a run page: Teaching / Course / Run', () => {
    const nav = render({ course: { slug: 'algebra', name: 'Algebra' }, runTitle: 'Spring' });
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Teaching', '/teaching'], ['Algebra', '/teaching/algebra'],
    ]);
    const current = nav.querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.tagName).toBe('SPAN');
    expect(current.textContent).toBe('Spring');
    const seps = Array.from(nav.querySelectorAll('.tc-sep'));
    expect(seps.map((s) => [s.textContent, s.getAttribute('aria-hidden')])).toEqual([['/', 'true'], ['/', 'true']]);
  });

  it('on a course page: Teaching / Course (current)', () => {
    const nav = render({ course: { slug: 'algebra', name: 'Algebra' } });
    expect(Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim())).toEqual(['Teaching']);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Algebra');
    expect(nav.querySelectorAll('.tc-sep')).toHaveLength(1);
  });

  it('links navigate in-app; a ⌘-click is left to the browser (C6)', async () => {
    history.replaceState(null, '', '/x');
    Object.assign(router.currentRoute, { path: '/x', search: '', hash: '' });
    const nav = render({ course: { slug: 'algebra', name: 'Algebra' }, runTitle: 'Spring' });
    const [teaching, course] = Array.from(nav.querySelectorAll('a'));
    await expectRoutesInApp(course, '/teaching/algebra');
    await expectRoutesInApp(teaching, '/teaching');
  });
});
