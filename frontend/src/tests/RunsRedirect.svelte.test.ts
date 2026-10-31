import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunsRedirect from '../pages/runs/RunsRedirect.svelte';
import { session } from '../stores/session.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import * as router from '../lib/router.svelte';

const user = {
  id: 1, email: 'u@x', full_name: 'U', is_superuser: false, is_disabled: false, photo_url: null,
  has_course_admin: true, has_run_teacher: false,
};

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function at(url: string) {
  history.replaceState(null, '', url);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); flushSync(); }

beforeEach(() => {
  __resetGuardsForTests();
  target = document.createElement('div');
  document.body.appendChild(target);
  session.user = { ...user };
  session.loading = false;
});
afterEach(() => {
  if (component) { unmount(component); component = null; }
  target.remove();
  vi.restoreAllMocks();
});

describe('RunsRedirect (spec §Navigation, Redirects)', () => {
  it('/courses/s/runs → /teaching/s, replacing the entry', async () => {
    at('/courses/s/runs');
    const before = history.length;
    component = mount(RunsRedirect, { target, props: { courseSlug: 's' } });
    await settle();
    expect(location.pathname).toBe('/teaching/s');
    expect(currentRoute.path).toBe('/teaching/s');
    expect(history.length).toBe(before);
  });

  it('/courses/s/runs/8?tab=groups#x → /teaching/s/runs/8?tab=groups#x', async () => {
    at('/courses/s/runs/8?tab=groups#x');
    component = mount(RunsRedirect, { target, props: { courseSlug: 's', runId: '8' } });
    await settle();
    expect(location.pathname + location.search + location.hash).toBe('/teaching/s/runs/8?tab=groups#x');
  });

  it('re-encodes the decoded slug', async () => {
    at('/courses/a%20b/runs');
    component = mount(RunsRedirect, { target, props: { courseSlug: 'a b' } });
    await settle();
    expect(location.pathname).toBe('/teaching/a%20b');
  });

  it('renders nothing', async () => {
    at('/courses/s/runs');
    const spy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));
    component = mount(RunsRedirect, { target, props: { courseSlug: 's' } });
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(target.innerHTML.replace(/<!---->/g, '').trim()).toBe('');
  });

  it('while session.user is null it calls no navigate, then redirects once the user is known', async () => {
    session.user = null;
    at('/courses/s/runs?x=1');
    const spy = vi.spyOn(router, 'navigate');
    component = mount(RunsRedirect, { target, props: { courseSlug: 's' } });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/courses/s/runs');
    session.user = { ...user };
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(location.pathname + location.search).toBe('/teaching/s?x=1');
  });
});
