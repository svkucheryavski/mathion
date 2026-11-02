import { describe, it, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CourseCard from '../components/course/CourseCard.svelte';
import SequenceLink from '../components/course/SequenceLink.svelte';
import AppHeader from '../components/chrome/AppHeader.svelte';
import { currentRoute, __resetGuardsForTests } from '../lib/router.svelte';
import { session } from '../stores/session.svelte';
import type { CourseListItem, User } from '../lib/types';
import { expectRoutesInApp } from './support/routeClickProbe';

// C6: every link with its own click handler lets ⌘/Ctrl/Shift/Alt and middle
// clicks through, and routes a plain click in-app.

let target: HTMLDivElement;
let component: ReturnType<typeof mount> | null = null;

function at(path: string): void {
  history.replaceState(null, '', path);
  currentRoute.path = location.pathname;
  currentRoute.search = location.search;
  currentRoute.hash = location.hash;
}

beforeEach(() => {
  __resetGuardsForTests();
  at('/somewhere');
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  target.remove();
  session.user = null;
});

function card(over: Partial<CourseListItem>): CourseListItem {
  return {
    course: { id: 1, slug: 'algebra', name: 'Algebra', description: '', is_admin: false },
    version_id: 3, version_state: 'published', covered_items: 1, total_items: 4,
    is_active: true, is_admin: false, ...over,
  };
}

function q(sel: string): Element {
  const el = target.querySelector(sel);
  if (!el) throw new Error(`no ${sel}`);
  return el;
}

describe('click-helper sites (C6)', () => {
  it('CourseCard, student: the card link', async () => {
    component = mount(CourseCard, { target, props: { course: card({}) } });
    flushSync();
    await expectRoutesInApp(q('a.card-link'), '/courses/algebra');
  });

  it('CourseCard, admin and enrolled: the title and the CTA', async () => {
    component = mount(CourseCard, { target, props: { course: card({ is_admin: true }) } });
    flushSync();
    await expectRoutesInApp(q('a.title-link'), '/courses/algebra');
    at('/somewhere');
    await expectRoutesInApp(q('a.cta'), '/courses/algebra');
  });

  it('CourseCard, admin only: the title, Edit and Runs', async () => {
    component = mount(CourseCard, { target, props: { course: card({ is_admin: true, version_id: null }) } });
    flushSync();
    await expectRoutesInApp(q('a.title-link'), '/courses/algebra/edit');
    at('/somewhere');
    const [edit, runs] = Array.from(target.querySelectorAll('a.foot-link'));
    await expectRoutesInApp(edit, '/courses/algebra/edit');
    at('/somewhere');
    await expectRoutesInApp(runs, '/teaching/algebra');
  });

  it('SequenceLink', async () => {
    component = mount(SequenceLink, {
      target,
      props: {
        courseSlug: 'algebra',
        sequence: { id: 5, title: 'Vectors', slug: 'vectors', order: 0, items: [] },
        state: { version_id: 3, items: {} },
      },
    });
    flushSync();
    await expectRoutesInApp(q('a.row'), '/courses/algebra/seq/5');
  });

  it('AppHeader: the brand, Authoring and Teaching', async () => {
    const user: User = {
      id: 1, email: 'a@x.test', full_name: 'A', is_superuser: false, is_disabled: false,
      photo_url: null, has_course_admin: true, has_run_teacher: true,
    };
    session.user = user;
    component = mount(AppHeader, { target });
    flushSync();
    await expectRoutesInApp(q('a.brand'), '/courses');
    at('/somewhere');
    await expectRoutesInApp(q('a[href="/courses"]:not(.brand)'), '/courses');
    at('/somewhere');
    await expectRoutesInApp(q('a[href="/teaching"]'), '/teaching');
  });
});
