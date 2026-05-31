import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mount,
  unmount,
  flushSync,
  type Component,
  type MountOptions,
  type ComponentProps,
} from 'svelte';
import MiniProjectModal from '../components/runs/MiniProjectModal.svelte';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

// T12 — Slice A modal teacher-gating (spec §6.2 MiniProjectModal bullets):
// the publish-precondition banner inside the modal renders bullets pointing
// the user to Overview. Two of those bullets describe actions only a course
// admin can perform (publishing the run, re-enabling a disabled course
// version) — for teachers the "Open Overview to ..." link must be hidden
// while the bullet text remains informative. The end-date bullet stays
// teacher-actionable because end_date is teacher-editable on Overview.

type ModalProps = ComponentProps<typeof MiniProjectModal>;

const baseCourse: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

const mounted: ReturnType<typeof mount>[] = [];
function trackedMount<Props extends Record<string, any>, Exports extends Record<string, any>>(
  component: Component<Props, Exports, string>,
  options: MountOptions<Props>,
): Exports {
  const cmp = mount(component, options);
  mounted.push(cmp);
  return cmp;
}

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
  while (mounted.length) {
    try {
      unmount(mounted.pop()!);
    } catch {
      /* already unmounted */
    }
  }
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

function jres(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response);
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const blocks: BlockResponse[] = [
  { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
];

function draftMp(overrides: Partial<MiniProjectResponse> = {}): MiniProjectResponse {
  return {
    id: 99,
    run_id: 10,
    block_id: 1,
    title: 'Mini project for Block 1',
    assignment_md: 'orig text',
    assignment_html: '<p>orig text</p>',
    soft_deadline: '2026-06-01T10:00:00Z',
    hard_deadline: '2026-06-15T10:00:00Z',
    resubmission_deadline: '2026-06-20T10:00:00Z',
    is_published: false,
    first_submitted_at: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function defaultProps(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    runId: 10,
    mode: 'edit',
    initial: draftMp(),
    availableBlocks: [],
    currentBlock: blocks[0],
    runIsPublished: true,
    versionIsDisabled: false,
    runEndDate: '2026-06-30',
    course: baseCourse,
    onClose: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
    onNavigateToTab: vi.fn(),
    ...overrides,
  };
}

describe('MiniProjectModal teacher-gating (spec §6.2)', () => {
  it('teacher + !runIsPublished: bullet "Run must be published" present, "Open Overview" link NOT rendered', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        runIsPublished: false,
        course: { ...baseCourse, is_admin: false },
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('[data-testid="publish-preconditions"]') as HTMLElement;
    expect(banner).toBeTruthy();
    // T12 R1 fix: bullet text stays verbatim — including the "— Open Overview
    // to publish." trailing clause — for teachers; only the <button> wrap is
    // omitted so the call-to-action becomes plain text instead of a link.
    const publishBullet = Array.from(banner.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Run must be published'),
    ) as HTMLElement | undefined;
    expect(publishBullet).toBeTruthy();
    expect(publishBullet!.textContent?.trim()).toBe(
      'Run must be published — Open Overview to publish.',
    );
    expect(publishBullet!.querySelector('button[data-action="publish-nav-overview"]')).toBeNull();
  });

  it('teacher + versionIsDisabled: bullet "course version is disabled" present, "Open Overview to re-enable" link NOT rendered', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        versionIsDisabled: true,
        course: { ...baseCourse, is_admin: false },
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('[data-testid="publish-preconditions"]') as HTMLElement;
    expect(banner).toBeTruthy();
    // T12 R1 fix: full verbatim bullet text for teachers, no truncation.
    const versionBullet = Array.from(banner.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('course version is disabled'),
    ) as HTMLElement | undefined;
    expect(versionBullet).toBeTruthy();
    expect(versionBullet!.textContent?.trim()).toBe(
      "This run's course version is disabled — Open Overview to re-enable it.",
    );
    expect(versionBullet!.querySelector('button[data-action="publish-nav-overview"]')).toBeNull();
  });

  it('teacher + runEndDate=null: bullet "Run end date must be set" present AND "Open Overview to set it" link IS rendered (teacher-editable)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        runEndDate: null,
        course: { ...baseCourse, is_admin: false },
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('[data-testid="publish-preconditions"]') as HTMLElement;
    expect(banner).toBeTruthy();
    const endDateBullet = Array.from(banner.querySelectorAll('li')).find((li) =>
      li.textContent?.includes('Run end date must be set'),
    ) as HTMLElement | undefined;
    expect(endDateBullet).toBeTruthy();
    expect(endDateBullet!.querySelector('button[data-action="publish-nav-overview"]')).toBeTruthy();
  });

  it('admin: all three admin-aware bullets render their "Open Overview" links (regression)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const target = document.createElement('div');
    document.body.appendChild(target);
    trackedMount(MiniProjectModal, {
      target,
      props: defaultProps({
        runIsPublished: false,
        versionIsDisabled: true,
        runEndDate: null,
        course: { ...baseCourse, is_admin: true },
      }) as ModalProps,
    });
    await settle();
    (target.querySelector('button[data-action="publish"]') as HTMLButtonElement).click();
    await settle();
    const banner = target.querySelector('[data-testid="publish-preconditions"]') as HTMLElement;
    expect(banner).toBeTruthy();
    const bullets = Array.from(banner.querySelectorAll('li'));
    const publishBullet = bullets.find((li) => li.textContent?.includes('Run must be published'));
    const versionBullet = bullets.find((li) => li.textContent?.includes('course version is disabled'));
    const endDateBullet = bullets.find((li) => li.textContent?.includes('Run end date must be set'));
    expect(publishBullet?.querySelector('button[data-action="publish-nav-overview"]')).toBeTruthy();
    expect(versionBullet?.querySelector('button[data-action="publish-nav-overview"]')).toBeTruthy();
    expect(endDateBullet?.querySelector('button[data-action="publish-nav-overview"]')).toBeTruthy();
  });
});
