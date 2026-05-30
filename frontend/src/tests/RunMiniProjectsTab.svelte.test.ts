import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunMiniProjectsTab from '../components/runs/RunMiniProjectsTab.svelte';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
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
  { id: 2, version_id: 7, title: 'Theory', slug: 'theory', order: 1, info: '', info_html: '' },
];

const baseCourse: Course = { id: 1, slug: 'c', name: 'C', description: '', is_admin: true };

// Centralised mount helper: builds defaults for all required props (including
// `course`, threaded as required by RunMiniProjectsTab at T12) and merges
// caller overrides. Course may be passed partial; it merges onto baseCourse so
// tests can write `course: { is_admin: false }`.
function mountMpTab(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const courseOverride = (extra.course as Partial<Course> | undefined) ?? {};
  const course: Course = { ...baseCourse, ...courseOverride };
  const { course: _c, ...rest } = extra;
  void _c;
  const defaults = {
    runId: 10,
    runIsPublished: true,
    runGroupsEnabled: true,
    runEndDate: '2026-06-30',
    versionIsDisabled: false,
    pinnedAvailable: true,
    blocks,
    miniProjects: [] as MiniProjectResponse[],
    onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
    onNavigateToTab: vi.fn(),
  };
  const cmp = mount(RunMiniProjectsTab, {
    target,
    props: { ...defaults, ...rest, course },
  });
  return { target, cmp };
}

describe('RunMiniProjectsTab', () => {
  it('empty state CTA with explainer + create hint when no MPs', async () => {
    const { target } = mountMpTab();
    await settle();
    expect(target.textContent).toContain('No mini-projects yet');
    expect(target.textContent).toContain('Click + New mini-project');
  });

  it('actionable banner when !runGroupsEnabled; link → onNavigateToTab("overview")', async () => {
    const onNav = vi.fn();
    const { target } = mountMpTab({ runGroupsEnabled: false, onNavigateToTab: onNav });
    await settle();
    expect(target.textContent).toContain('Mini-projects require groups');
    const link = target.querySelector('button[data-action="nav-overview-groups"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
  });

  it('actionable banner when versionIsDisabled; [+ New] disabled with tooltip (spec lines 548, 595)', async () => {
    const onNav = vi.fn();
    const { target } = mountMpTab({ versionIsDisabled: true, onNavigateToTab: onNav });
    await settle();
    expect(target.textContent).toContain("This run's course version is disabled");
    const link = target.querySelector('button[data-action="nav-overview-version"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
    const newBtn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(newBtn.disabled).toBe(true);
    expect(newBtn.getAttribute('title')).toContain("course version is disabled");
    expect(target.querySelector('button[data-action="publish"]')).toBeNull();
  });

  it('actionable banner when !runIsPublished; [+ New] and Edit remain enabled; NO row-level Publish button (spec lines 549, 553, 596)', async () => {
    const onNav = vi.fn();
    const draftMp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: false, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const { target } = mountMpTab({
      runIsPublished: false,
      miniProjects: [draftMp],
      onNavigateToTab: onNav,
    });
    await settle();
    expect(target.textContent).toContain('Run is not yet published');
    const link = target.querySelector('button[data-action="nav-overview-publish"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
    const newBtn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(newBtn.disabled).toBe(false);
    const editBtn = target.querySelector('button[data-action="edit"]') as HTMLButtonElement;
    expect(editBtn).toBeTruthy();
    expect(editBtn.disabled).toBe(false);
    expect(target.querySelector('button[data-action="publish"]')).toBeNull();
  });

  it('pinnedAvailable=false: "Cannot load — pinned version not found"', async () => {
    const { target } = mountMpTab({ pinnedAvailable: false, blocks: [] });
    await settle();
    expect(target.textContent).toContain('Cannot load');
  });

  it('all-blocks-used → [+ New] disabled', async () => {
    const mps: MiniProjectResponse[] = blocks.map((b, i) => ({
      id: i + 1, run_id: 10, block_id: b.id,
      title: `Mini project for Block ${b.order}`,
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: false, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    }));
    const { target } = mountMpTab({ miniProjects: mps });
    await settle();
    const btn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('already have a mini-project');
  });

  it('MP rows sorted by block.order asc; status pill mapping', async () => {
    const mps: MiniProjectResponse[] = [
      { id: 2, run_id: 10, block_id: 2, title: 'Mini project for Block 1', assignment_md: 'x', assignment_html: '<p>x</p>', soft_deadline: null, hard_deadline: null, resubmission_deadline: null, is_published: true, first_submitted_at: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
      { id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0', assignment_md: 'x', assignment_html: '<p>x</p>', soft_deadline: null, hard_deadline: null, resubmission_deadline: null, is_published: false, first_submitted_at: '2026-05-22T00:00:00Z', created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    ];
    const { target } = mountMpTab({ miniProjects: mps });
    await settle();
    const rows = Array.from(target.querySelectorAll('[data-role="mp-row"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Block 0');
    expect(rows[0].textContent).toContain('Locked');
    expect(rows[1].textContent).toContain('Block 1');
    expect(rows[1].textContent).toContain('Published');
    expect(rows[0].querySelector('button[data-action="edit"]')).toBeNull();
    // Modal-only-publish contract (spec line 553): NO row-level Publish button on
    // ANY MP state, including Published and Locked rows. Locks the contract for
    // the states this test renders.
    expect(rows[0].querySelector('button[data-action="publish"]')).toBeNull();
    expect(rows[1].querySelector('button[data-action="publish"]')).toBeNull();
  });

  it('force-delete confirm: copy includes "permanently remove" + checkbox + danger button (no count)', async () => {
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: '2026-05-22T00:00:00Z',
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const { target } = mountMpTab({ miniProjects: [mp] });
    await settle();
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toContain('Force delete will permanently remove');
    expect(target.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(target.textContent).not.toMatch(/\d+ submission/);
  });

  it('409 on non-locked delete: flips row into force-confirm view (spec line 525)', async () => {
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const lockedMp = { ...mp, first_submitted_at: '2026-05-22T00:00:00Z' };

    fetchSpy.mockImplementation((url, init) => {
      if ((init as RequestInit | undefined)?.method === 'DELETE' && String(url).endsWith('/api/mini-projects/1')) {
        return jres(
          { detail: 'Mini-project has submissions; use ?force=true to delete.' },
          409,
        );
      }
      return jres([lockedMp]);
    });

    // Mount this case directly (NOT via mountMpTab) because the `$state`
    // proxy must be forwarded verbatim to `mount(...)`'s `props` — spreading
    // into `{ ...defaults, ...rest }` materialises a fresh object and breaks
    // the reactive link so the post-refetch mutation never re-renders.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks: localBlocks,
      miniProjects: [mp],
      onRefetchMiniProjects: vi.fn().mockImplementation(async () => {
        propsRef.miniProjects = [lockedMp];
      }),
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();

    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    const confirmBtn = target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();

    confirmBtn.click();
    await settle();

    expect(propsRef.onRefetchMiniProjects).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain('Force delete will permanently remove');
    expect(target.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(target.querySelector('button.danger')).toBeTruthy();

    unmount(cmp);
  });

  it('force-delete fails (5xx): surfaces deleteError banner, keeps force-confirm view open, clears checkbox', async () => {
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const lockedMp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: '2026-05-22T00:00:00Z',
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    fetchSpy.mockImplementation((url, init) => {
      if ((init as RequestInit | undefined)?.method === 'DELETE' && String(url).includes('force=true')) {
        return jres({ detail: 'Internal server error' }, 503);
      }
      return jres([lockedMp]);
    });
    const { target, cmp } = mountMpTab({ blocks: localBlocks, miniProjects: [lockedMp] });
    await settle();
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    const checkbox = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    (target.querySelector('button.danger') as HTMLButtonElement).click();
    await settle();
    expect(target.textContent).toMatch(/Internal server error/);
    expect(target.querySelector('[data-role="delete-error-banner"]')).toBeTruthy();
    expect(target.textContent).toContain('Force delete will permanently remove');
    expect((target.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    unmount(cmp);
  });

  it('409 on non-locked delete + refetch ALSO fails: surfaces deleteError banner, resets confirm state', async () => {
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    fetchSpy.mockImplementation((_url, init) => {
      if ((init as RequestInit | undefined)?.method === 'DELETE') {
        return jres({ detail: 'has submissions; use ?force=true' }, 409);
      }
      return jres([mp]);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks: localBlocks,
      miniProjects: [mp],
      onRefetchMiniProjects: vi.fn().mockRejectedValue(new Error('network down')),
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    (target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement).click();
    await settle();

    expect(propsRef.onRefetchMiniProjects).toHaveBeenCalledTimes(1);
    expect(target.querySelector('button[data-action="confirm-delete"]')).toBeNull();
    expect(target.textContent).toMatch(/Could not refresh.*retry/i);
    expect(target.querySelector('[data-role="delete-error-banner"]')).toBeTruthy();

    unmount(cmp);
  });

  it('successful normal delete refetches BOTH miniProjects and assets (keeps is_referenced in sync)', async () => {
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const mp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };

    fetchSpy.mockImplementation((url, init) => {
      if ((init as RequestInit | undefined)?.method === 'DELETE' && String(url).endsWith('/api/mini-projects/1')) {
        return jres(null, 204);
      }
      return jres([]);
    });

    const onRefetchMiniProjects = vi.fn().mockResolvedValue(undefined);
    const onRefetchAssets = vi.fn().mockResolvedValue(undefined);

    const { target, cmp } = mountMpTab({
      blocks: localBlocks,
      miniProjects: [mp],
      onRefetchMiniProjects,
      onRefetchAssets,
    });
    await settle();

    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    const confirmBtn = target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement;
    confirmBtn.click();
    await settle();

    expect(onRefetchMiniProjects).toHaveBeenCalledTimes(1);
    expect(onRefetchAssets).toHaveBeenCalledTimes(1);

    unmount(cmp);
  });
});

describe('RunMiniProjectsTab — pendingEditTarget consumption', () => {
  const mpFix: MiniProjectResponse = {
    id: 10, run_id: 10, block_id: 1, title: 'MP A',
    assignment_md: 'doc body', assignment_html: '<p>doc body</p>',
    soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
    is_published: false, first_submitted_at: null,
    created_at: '2026-05-20T12:00:00Z', updated_at: '2026-05-20T12:00:00Z',
  };

  function baseProps(overrides: Record<string, unknown> = {}) {
    return {
      runIsPublished: false,
      miniProjects: [mpFix],
      ...overrides,
    };
  }

  it('truthy pendingEditTarget → modal opens in edit mode + onPendingEditConsumed fires once', async () => {
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab(baseProps({ pendingEditTarget: mpFix, onPendingEditConsumed }));
    await settle();

    const dialog = target.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // Edit-mode signature: header reads "Edit — Block 0 — Intro" (mode === 'edit')
    const heading = target.querySelector('#mp-modal-title');
    expect(heading?.textContent ?? '').toMatch(/^Edit —/);
    expect(heading?.textContent ?? '').toContain('Intro');
    expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);

    unmount(cmp);
  });

  it('stale pendingEditTarget (id not in miniProjects) → modal NOT opened, consumed still fires', async () => {
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab(baseProps({
      pendingEditTarget: { ...mpFix, id: 99999 },
      onPendingEditConsumed,
    }));
    await settle();

    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);

    unmount(cmp);
  });

  it('null pendingEditTarget → effect short-circuits, no consumed callback, no modal', async () => {
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab(baseProps({ pendingEditTarget: null, onPendingEditConsumed }));
    await settle();

    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(onPendingEditConsumed).not.toHaveBeenCalled();

    unmount(cmp);
  });
});

// T12 — Slice A teacher-gating (spec §6.2):
//   * RunMiniProjectsTab.teacher-gating bullets
//     - locked-row force-delete affordance hidden for teachers
//     - "Publish on Overview" CTA hidden for teachers
//     - "Enable on Overview" CTA hidden for teachers when published
//     - "See Overview" version-disabled CTA hidden for teachers
//     - newDisabledTitle wording for teachers when groups missing on published run
//   * Admin counterparts must keep current behaviour (regression coverage).
describe('RunMiniProjectsTab — T12 teacher-gating (spec §6.2)', () => {
  const lockedMp: MiniProjectResponse = {
    id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
    assignment_md: 'x', assignment_html: '<p>x</p>',
    soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
    is_published: true, first_submitted_at: '2026-04-15T10:00:00Z',
    created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
  };
  const unlockedMp: MiniProjectResponse = {
    ...lockedMp,
    first_submitted_at: null,
  };

  it('teacher + locked MP: no Delete × button rendered for that row, no force-confirm UI', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [lockedMp],
    });
    await settle();
    const row = target.querySelector('[data-role="mp-row"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector('button[data-action="delete"]')).toBeNull();
    expect(target.textContent).not.toContain('Force delete will permanently remove');
  });

  it('admin + locked MP: Delete × button present; clicking opens force-confirm with "I understand"', async () => {
    const { target } = mountMpTab({
      course: { is_admin: true },
      miniProjects: [lockedMp],
    });
    await settle();
    const btn = target.querySelector('button[data-action="delete"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    await settle();
    expect(target.textContent).toContain('Force delete will permanently remove');
    expect(target.textContent).toContain('I understand');
  });

  it('teacher + unlocked MP: Delete × button IS rendered (teacher-allowed normal delete)', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [unlockedMp],
    });
    await settle();
    const row = target.querySelector('[data-role="mp-row"]') as HTMLElement;
    expect(row.querySelector('button[data-action="delete"]')).toBeTruthy();
  });

  it('teacher + !runIsPublished: "Run is not yet published" banner text rendered, but "Publish on Overview" link NOT in DOM', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      runIsPublished: false,
    });
    await settle();
    expect(target.textContent).toContain('Run is not yet published');
    expect(target.querySelector('button[data-action="nav-overview-publish"]')).toBeNull();
  });

  it('admin + !runIsPublished: BOTH banner text AND "Publish on Overview" link are present', async () => {
    const { target } = mountMpTab({
      course: { is_admin: true },
      runIsPublished: false,
    });
    await settle();
    expect(target.textContent).toContain('Run is not yet published');
    expect(target.querySelector('button[data-action="nav-overview-publish"]')).toBeTruthy();
  });

  it('teacher + published + !runGroupsEnabled: "Enable on Overview" link NOT rendered, banner text IS', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      runIsPublished: true,
      runGroupsEnabled: false,
    });
    await settle();
    expect(target.textContent).toContain('Mini-projects require groups');
    expect(target.querySelector('button[data-action="nav-overview-groups"]')).toBeNull();
  });

  it('teacher + !published + !runGroupsEnabled: "Enable on Overview" link IS rendered (teacher can act while unpublished)', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      runIsPublished: false,
      runGroupsEnabled: false,
    });
    await settle();
    expect(target.textContent).toContain('Mini-projects require groups');
    expect(target.querySelector('button[data-action="nav-overview-groups"]')).toBeTruthy();
  });

  it('admin + !runGroupsEnabled (published): "Enable on Overview" link IS rendered regardless of publish state', async () => {
    const { target } = mountMpTab({
      course: { is_admin: true },
      runIsPublished: true,
      runGroupsEnabled: false,
    });
    await settle();
    expect(target.querySelector('button[data-action="nav-overview-groups"]')).toBeTruthy();
  });

  it('teacher + versionIsDisabled: "See Overview" link NOT rendered, banner text IS', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      versionIsDisabled: true,
    });
    await settle();
    expect(target.textContent).toContain("This run's course version is disabled");
    expect(target.querySelector('button[data-action="nav-overview-version"]')).toBeNull();
  });

  it('admin + versionIsDisabled: "See Overview" link IS rendered', async () => {
    const { target } = mountMpTab({
      course: { is_admin: true },
      versionIsDisabled: true,
    });
    await settle();
    expect(target.querySelector('button[data-action="nav-overview-version"]')).toBeTruthy();
  });

  it('teacher + runIsPublished + !runGroupsEnabled: newDisabledTitle on [+ New] mentions "Ask a course admin"', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      runIsPublished: true,
      runGroupsEnabled: false,
    });
    await settle();
    const btn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('title')).toContain('Ask a course admin');
  });

  it('teacher + !runIsPublished + !runGroupsEnabled: newDisabledTitle on [+ New] uses "Enable groups on Overview" wording', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      runIsPublished: false,
      runGroupsEnabled: false,
    });
    await settle();
    const btn = target.querySelector('button[data-action="new-mp"]') as HTMLButtonElement;
    expect(btn.getAttribute('title')).toContain('Enable groups on Overview');
  });

  it('modal Publish button is teacher-visible (spec §3.1.6 — MP publish stays teacher-allowed)', async () => {
    // Spec §3.1.6: mini-project publish is allowed for teachers. Ensure the
    // modal's [Publish…] button stays in the DOM for a teacher viewing an
    // unpublished MP via the Edit modal.
    const draftMp: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: '2026-06-15T10:00:00Z',
      resubmission_deadline: '2026-06-20T10:00:00Z',
      is_published: false, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [draftMp],
    });
    await settle();
    (target.querySelector('button[data-action="edit"]') as HTMLButtonElement).click();
    await settle();
    const dialog = target.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('button[data-action="publish"]')).toBeTruthy();
  });
});
