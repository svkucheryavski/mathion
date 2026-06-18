import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MiniProjectLink from '../components/course/MiniProjectLink.svelte';
import type { StudentMiniProjectListItem } from '../lib/types';
import { LATEST_STATUS_META, type LatestStatus } from '../lib/studentMiniProjects';

// Per the codebase memory rule: component tests use mount/unmount/flushSync
// from `svelte`, NOT @testing-library/svelte.

let target: HTMLDivElement;
let component: ReturnType<typeof mount>;

beforeEach(() => {
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  if (component) unmount(component);
  document.body.removeChild(target);
});

const BASE_ITEM: StudentMiniProjectListItem = {
  mp_id: 1,
  block_id: 7,
  block_slug: 'intro',
  block_order: 0,
  block_title: 'Introduction',
  hard_deadline: null,
  soft_deadline: null,
  resubmission_deadline: null,
  latest_status: 'accepted',
};

describe('MiniProjectLink', () => {
  it('renders href with encodeURIComponent applied to BOTH courseSlug and block_slug (C10)', () => {
    // Both slugs contain '/' — encodeURIComponent must turn them into '%2F'
    // so the SPA route resolves to the intended block, not a sub-path.
    component = mount(MiniProjectLink, {
      target,
      props: {
        courseSlug: 'a/b',
        item: { ...BASE_ITEM, block_slug: 'c/d' },
      },
    });
    flushSync();
    const a = target.querySelector('a.row.row-mp') as HTMLAnchorElement | null;
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('/courses/a%2Fb/blocks/c%2Fd/mini-project');
  });

  it('composes StatusPill with item.latest_status (visible label from LATEST_STATUS_META)', () => {
    component = mount(MiniProjectLink, {
      target,
      props: { courseSlug: 'intro-course', item: { ...BASE_ITEM, latest_status: 'major_revision' } },
    });
    flushSync();
    const pill = target.querySelector('a.row-mp .pill');
    expect(pill).not.toBeNull();
    expect(pill!.classList.contains('pill-warning')).toBe(true);
    expect(pill!.textContent).toContain('Needs revision (major)');
  });

  const ALL_STATUSES: LatestStatus[] = [
    'pending_group_assignment',
    'not_submitted',
    'awaiting_evaluation',
    'rejected',
    'major_revision',
    'minor_revision',
    'accepted',
  ];

  it.each(ALL_STATUSES)(
    'embeds StatusPill with correct meta for status %s (spec §8: all 7 statuses)',
    (status) => {
      component = mount(MiniProjectLink, {
        target,
        props: { courseSlug: 'c', item: { ...BASE_ITEM, latest_status: status } },
      });
      flushSync();

      const pill = target.querySelector('a.row-mp .pill');
      expect(pill).not.toBeNull();
      const meta = LATEST_STATUS_META[status];
      expect(pill!.classList.contains(meta.cls)).toBe(true);
      expect(pill!.textContent).toContain(meta.label);
      const tokenEl = pill!.querySelector('.pill-token');
      expect(tokenEl).not.toBeNull();
      expect(tokenEl!.textContent).toBe(meta.token);
    },
  );

  it('sets aria-label on <a> as "Mini-project: {title}, Status: {label}" (sole AT status announcement)', () => {
    component = mount(MiniProjectLink, {
      target,
      props: { courseSlug: 'c', item: { ...BASE_ITEM, latest_status: 'awaiting_evaluation' } },
    });
    flushSync();
    const a = target.querySelector('a.row.row-mp');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('aria-label')).toBe(
      'Mini-project: Introduction, Status: Awaiting evaluation',
    );
  });

  it('does NOT set aria-label on the embedded pill (D3: link owns the announcement)', () => {
    component = mount(MiniProjectLink, {
      target,
      props: { courseSlug: 'c', item: BASE_ITEM },
    });
    flushSync();
    const pill = target.querySelector('a.row-mp .pill');
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute('aria-label')).toBeNull();
  });

  it('marks the leading glyph span with aria-hidden="true" (decorative, not read)', () => {
    component = mount(MiniProjectLink, {
      target,
      props: { courseSlug: 'c', item: BASE_ITEM },
    });
    flushSync();
    const glyph = target.querySelector('a.row-mp .row-glyph');
    expect(glyph).not.toBeNull();
    expect(glyph!.getAttribute('aria-hidden')).toBe('true');
    expect(glyph!.textContent).toBe('📋');
  });

  it('falls back to "Untitled block" in BOTH aria-label and visible title when block_title is whitespace', () => {
    // Whitespace-only is treated the same as empty: defensive against
    // malformed drafts that slip through. The fallback MUST match between
    // the aria-label and the visible text so AT and sighted users see the
    // same identifier.
    component = mount(MiniProjectLink, {
      target,
      props: {
        courseSlug: 'c',
        item: { ...BASE_ITEM, block_title: '   ', latest_status: 'not_submitted' },
      },
    });
    flushSync();
    const a = target.querySelector('a.row.row-mp');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('aria-label')).toBe(
      'Mini-project: Untitled block, Status: Not yet submitted',
    );
    const title = target.querySelector('a.row-mp .row-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Mini-project: Untitled block');
  });
});
