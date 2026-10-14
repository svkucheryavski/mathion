import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount as svelteUnmount, flushSync } from 'svelte';
import RunMiniProjectsTab from '../components/runs/RunMiniProjectsTab.svelte';
import type { Course, MiniProjectResponse, BlockResponse } from '../lib/types';
import { toasts, clearToasts } from '../stores/toasts.svelte';

const fetchSpy = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  document.body.innerHTML = '';
});

afterEach(() => {
  while (mountedTabs.length) svelteUnmount(mountedTabs.pop()!);
  clearToasts();
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

const mpBase: MiniProjectResponse = {
  id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
  assignment_md: 'x', assignment_html: '<p>x</p>',
  soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
  is_published: false, first_submitted_at: null,
  created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
};
const mkMp = (o: Partial<MiniProjectResponse> = {}): MiniProjectResponse => ({ ...mpBase, ...o });
const byAction = (t: HTMLElement, a: string) => t.querySelector(`button[data-action="${a}"]`) as HTMLButtonElement | null;

// Centralised mount helper: builds defaults for all required props (including
// `course`, threaded as required by RunMiniProjectsTab at T12) and merges
// caller overrides. Course may be passed partial; it merges onto baseCourse so
// tests can write `course: { is_admin: false }`.
const mountedTabs: ReturnType<typeof mount>[] = [];
// A test that unmounts its own tab drops it from the list, so afterEach does
// not unmount it twice (Svelte warns lifecycle_double_unmount; it never throws).
function unmount(cmp: ReturnType<typeof mount>) {
  const i = mountedTabs.indexOf(cmp);
  if (i >= 0) mountedTabs.splice(i, 1);
  svelteUnmount(cmp);
}
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
  mountedTabs.push(cmp);
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

  it('versionIsDisabled (admin): only the "See Overview" line; [+ New] disabled with tooltip (R7)', async () => {
    const onNav = vi.fn();
    const { target } = mountMpTab({ versionIsDisabled: true, onNavigateToTab: onNav });
    await settle();
    // R7: the frame shows the version banner once; the tab keeps only the admin's link.
    expect(target.textContent).not.toContain("This run's course version is disabled");
    expect(target.querySelector('.mp-note button[data-action="nav-overview-version"]')?.textContent).toBe('See Overview');
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

  it('rows sorted by block position, "Block {n} — title" (R13); lowercase state chips; locked ✎ disabled with its reason', async () => {
    const mps = [
      mkMp({ id: 2, block_id: 2, is_published: true }),
      mkMp({ id: 1, block_id: 1, first_submitted_at: '2026-05-22T00:00:00Z' }),
    ];
    const { target } = mountMpTab({ miniProjects: mps });
    await settle();
    const rows = Array.from(target.querySelectorAll('tr[data-role="mp-row"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.mp-block')?.textContent).toBe('Block 1 — Intro');
    expect(rows[0].querySelector('.mp-chip')?.textContent).toBe('locked');
    expect(rows[1].querySelector('.mp-block')?.textContent).toBe('Block 2 — Theory');
    expect(rows[1].querySelector('.mp-chip')?.textContent).toBe('published');
    const lockedEdit = rows[0].querySelector('button[data-action="edit"]') as HTMLButtonElement;
    expect(lockedEdit.disabled).toBe(true);
    expect(lockedEdit.getAttribute('title')).toBe('Has submissions — editing is off');
    expect(lockedEdit.getAttribute('aria-label')).toBe('Edit mini-project for Block 1');
    // Modal-only publish (spec line 553): no row-level Publish button on any state.
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
    expect(target.querySelector('button[data-action="force-delete"]')).toBeTruthy();

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
    (target.querySelector('button[data-action="force-delete"]') as HTMLButtonElement).click();
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

  it('teacher + locked MP: 🗑 opens the danger panel with Force delete disabled and its reason (R5)', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [lockedMp],
    });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    expect(target.textContent).toContain('Force delete will permanently remove');
    const force = byAction(target, 'force-delete')!;
    expect(force.disabled).toBe(true);
    expect(force.getAttribute('title')).toBe('Only a course admin can force delete.');
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

  it('teacher + versionIsDisabled: no version line at all (R7)', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      versionIsDisabled: true,
    });
    await settle();
    expect(target.textContent).not.toContain("This run's course version is disabled");
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

  it('teacher: 409-race transition — force-confirm panel does NOT render after locally-unlocked MP becomes locked server-side', async () => {
    // T12 R1 fix: defense-in-depth gate. If a teacher opens InlineConfirm on
    // a row that was unlocked at click time, but a student submits in the
    // gap so the server-side state becomes locked, the post-409 refetch
    // will deliver a now-locked MP. The render branch for the
    // force-confirm <div> must remain hidden for !course.is_admin even
    // when deleteConfirmId is still set from the prior click.
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const unlocked: MiniProjectResponse = {
      id: 1, run_id: 10, block_id: 1, title: 'Mini project for Block 0',
      assignment_md: 'x', assignment_html: '<p>x</p>',
      soft_deadline: null, hard_deadline: null, resubmission_deadline: null,
      is_published: true, first_submitted_at: null,
      created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
    };
    const lockedAfterRace: MiniProjectResponse = {
      ...unlocked,
      first_submitted_at: '2026-04-15T10:00:00Z',
    };

    fetchSpy.mockImplementation((url, init) => {
      if ((init as RequestInit | undefined)?.method === 'DELETE' && String(url).endsWith('/api/mini-projects/1')) {
        return jres(
          { detail: 'Mini-project has submissions; use ?force=true to delete.' },
          409,
        );
      }
      return jres([lockedAfterRace]);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks: localBlocks,
      miniProjects: [unlocked],
      onRefetchMiniProjects: vi.fn().mockImplementation(async () => {
        propsRef.miniProjects = [lockedAfterRace];
      }),
      onNavigateToTab: vi.fn(),
      course: { ...baseCourse, is_admin: false },
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();

    // Teacher sees Delete × because the row is unlocked at click time.
    (target.querySelector('button[data-action="delete"]') as HTMLButtonElement).click();
    await settle();
    const confirmBtn = target.querySelector('button[data-action="confirm-delete"]') as HTMLButtonElement;
    expect(confirmBtn).toBeTruthy();

    confirmBtn.click();
    await settle();

    expect(propsRef.onRefetchMiniProjects).toHaveBeenCalledTimes(1);
    // Defense-in-depth: force-confirm panel must NOT appear for teachers
    // even though the (now-locked) MP would trigger the locked branch for
    // an admin.
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(target.textContent).not.toContain('Force delete will permanently remove');
    expect(target.textContent).not.toContain('I understand');

    // Teacher MUST receive explicit feedback via the deleteError banner —
    // pin the exact wording so a silent removal of the assignment in
    // handleDeleteConfirm's non-admin 409 branch fails this test.
    const banner = target.querySelector('[data-role="delete-error-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain(
      'This mini-project now has submissions and cannot be deleted. Ask a course admin to force-delete.',
    );

    unmount(cmp);
  });

  it('teacher: a row that turns locked while its confirm is open swaps to the danger panel with Force delete disabled', async () => {
    const localBlocks: BlockResponse[] = [
      { id: 1, version_id: 7, title: 'Intro', slug: 'intro', order: 0, info: '', info_html: '' },
    ];
    const unlocked = mkMp({ is_published: true });
    const locked = mkMp({ is_published: true, first_submitted_at: '2026-04-15T10:00:00Z' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks: localBlocks,
      miniProjects: [unlocked],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
      course: { ...baseCourse, is_admin: false },
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    expect(byAction(target, 'confirm-delete')).not.toBeNull();
    propsRef.miniProjects = [locked];
    await settle();
    expect(byAction(target, 'confirm-delete')).toBeNull();
    expect(byAction(target, 'force-delete')!.disabled).toBe(true);
    unmount(cmp);
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

describe('RunMiniProjectsTab — 6a restyle', () => {
  it('header: h2 with the mono "N of M blocks" count; + is an icon button named "New mini-project"', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp()] });
    await settle();
    const h2 = target.querySelector('h2') as HTMLElement;
    expect(h2.textContent?.replace(/\s+/g, ' ').trim()).toBe('Mini-projects 1 of 2 blocks');
    expect(h2.getAttribute('tabindex')).toBe('-1');
    const plus = byAction(target, 'new-mp')!;
    expect(plus.getAttribute('data-glyph')).toBe('plus');
    expect(plus.getAttribute('aria-label')).toBe('New mini-project');
    expect(plus.getAttribute('title')).toBe('New mini-project');
  });

  it('the count takes its singular at one block', async () => {
    const { target } = mountMpTab({ blocks: [blocks[0]!], miniProjects: [mkMp()] });
    await settle();
    expect(target.querySelector('.sec-count')?.textContent).toBe('1 of 1 block');
  });

  it('"Block {n}" follows list position, not the stored order (R13)', async () => {
    const gapBlocks: BlockResponse[] = [
      { id: 5, version_id: 7, title: 'Vectors', slug: 'v', order: 1, info: '', info_html: '' },
      { id: 9, version_id: 7, title: 'Matrices', slug: 'm', order: 3, info: '', info_html: '' },
    ];
    const { target } = mountMpTab({ blocks: gapBlocks, miniProjects: [mkMp({ id: 1, block_id: 9 }), mkMp({ id: 2, block_id: 5 })] });
    await settle();
    expect(Array.from(target.querySelectorAll('.mp-block')).map((c) => c.textContent))
      .toEqual(['Block 1 — Vectors', 'Block 2 — Matrices']);
  });

  it('deadlines: short English form with time; full value in title; zone in the header (R12)', async () => {
    const { target } = mountMpTab({
      miniProjects: [mkMp({ soft_deadline: '2026-08-07T21:59:00Z', hard_deadline: '2026-08-14T21:59:00Z' })],
    });
    await settle();
    const parts = Array.from(target.querySelectorAll('.mp-dl .dl')) as HTMLElement[];
    expect(parts.map((p) => p.textContent)).toEqual(['soft 07 Aug 23:59', 'hard 14 Aug 23:59']);
    expect(parts[0]!.getAttribute('title')).toBe('2026-08-07 23:59 GMT+2');
    expect(target.querySelectorAll('thead th')[1]!.textContent).toBe('Deadlines (GMT+2)');
  });

  it('mixed offsets give "Deadlines (local time)"; each part keeps its own offset (Review Focus 5)', async () => {
    const { target } = mountMpTab({
      miniProjects: [
        mkMp({ id: 1, block_id: 1, soft_deadline: '2026-08-07T21:59:00Z' }),
        mkMp({ id: 2, block_id: 2, resubmission_deadline: '2026-01-10T22:59:00Z' }),
      ],
    });
    await settle();
    expect(target.querySelectorAll('thead th')[1]!.textContent).toBe('Deadlines (local time)');
    const parts = Array.from(target.querySelectorAll('.mp-dl .dl')) as HTMLElement[];
    expect(parts.map((p) => p.textContent)).toEqual(['soft 07 Aug 23:59', 'resub 10 Jan 23:59']);
    expect(parts[0]!.getAttribute('title')).toBe('2026-08-07 23:59 GMT+2');
    expect(parts[1]!.getAttribute('title')).toBe('2026-01-10 23:59 GMT+1');
  });

  it('no deadlines: the header reads "Deadlines"', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp()] });
    await settle();
    expect(target.querySelectorAll('thead th')[1]!.textContent).toBe('Deadlines');
    expect(target.querySelectorAll('.mp-dl .dl')).toHaveLength(0);
  });

  it('a disabled version: ✎ on a draft row is disabled with the version reason', async () => {
    const { target } = mountMpTab({ versionIsDisabled: true, miniProjects: [mkMp()] });
    await settle();
    const edit = byAction(target, 'edit')!;
    expect(edit.disabled).toBe(true);
    expect(edit.getAttribute('title')).toBe("This run's course version is disabled.");
  });

  it('every row shows its 🗑, named by the block', async () => {
    const { target } = mountMpTab({
      course: { is_admin: false },
      miniProjects: [mkMp({ id: 1, block_id: 1, first_submitted_at: '2026-05-22T00:00:00Z' }), mkMp({ id: 2, block_id: 2 })],
    });
    await settle();
    const trash = Array.from(target.querySelectorAll('button[data-action="delete"]'));
    expect(trash.map((b) => b.getAttribute('aria-label'))).toEqual(['Delete mini-project for Block 1', 'Delete mini-project for Block 2']);
  });

  it('the danger panel is a full-width row under its row (P12); Cancel returns focus to the 🗑', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp({ first_submitted_at: '2026-05-22T00:00:00Z' })] });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    const panelRow = target.querySelector('tr.mp-panel-row') as HTMLTableRowElement;
    expect(panelRow.previousElementSibling?.getAttribute('data-role')).toBe('mp-row');
    expect(panelRow.querySelector('td')?.getAttribute('colspan')).toBe('4');
    expect(document.activeElement?.getAttribute('data-role')).toBe('danger-ack');
    (Array.from(panelRow.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('tr.mp-panel-row')).toBeNull();
    expect(document.activeElement).toBe(byAction(target, 'delete'));
  });

  it('the plain confirm is a one-line full-width row under its row (Safari pass), takes focus, and Cancel returns focus to the 🗑', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp()] });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    const row = byAction(target, 'confirm-delete')!.closest('tr') as HTMLTableRowElement;
    expect(row.classList.contains('mp-panel-row')).toBe(true);
    expect(row.previousElementSibling?.getAttribute('data-role')).toBe('mp-row');
    expect(row.querySelector('td')?.getAttribute('colspan')).toBe('4');
    expect(row.querySelector('.inline-confirm.row')?.textContent).toMatch(/Delete this mini-project\?/);
    expect(row.querySelector('.inline-confirm')?.classList.contains('end')).toBe(true);   // under the 🗑 (D42)
    const cell = target.querySelector('tr[data-role="mp-row"] .mp-actions') as HTMLElement;
    expect(cell.querySelector('.inline-confirm')).toBeNull();
    expect(cell.querySelector('[data-action="delete"]')).not.toBeNull();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    (document.activeElement as HTMLButtonElement).click();
    await settle();
    expect(document.activeElement).toBe(byAction(target, 'delete'));
  });

  it('deleting the only mini-project moves focus to +', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks,
      miniProjects: [mkMp()],
      onRefetchMiniProjects: async () => { propsRef.miniProjects = []; },
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    byAction(target, 'delete')!.click();
    await settle();
    byAction(target, 'confirm-delete')!.click();
    await settle();
    await settle();
    expect(target.textContent).toContain('No mini-projects yet');
    expect(document.activeElement).toBe(byAction(target, 'new-mp'));
    unmount(cmp);
  });

  it('deleting the only mini-project while + is disabled moves focus to the h2 (Review Focus 3)', async () => {
    fetchSpy.mockImplementation(() => jres(null, 204));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const propsRef: any = $state({
      runId: 10, runIsPublished: false, runGroupsEnabled: false,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks,
      miniProjects: [mkMp()],
      onRefetchMiniProjects: async () => { propsRef.miniProjects = []; },
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: propsRef });
    await settle();
    expect(byAction(target, 'new-mp')!.disabled).toBe(true);
    byAction(target, 'delete')!.click();
    await settle();
    byAction(target, 'confirm-delete')!.click();
    await settle();
    await settle();
    expect(document.activeElement).toBe(target.querySelector('h2'));
    unmount(cmp);
  });

  it('banners: info banners carry their class; the delete error is an alert with Dismiss', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Boom' }, 500));
    const { target } = mountMpTab({ runIsPublished: false, runGroupsEnabled: false, miniProjects: [mkMp()] });
    await settle();
    expect(target.querySelectorAll('.mp-banner:not(.mp-banner-err)')).toHaveLength(2);
    byAction(target, 'delete')!.click();
    await settle();
    byAction(target, 'confirm-delete')!.click();
    await settle();
    const err = target.querySelector('[data-role="delete-error-banner"]') as HTMLElement;
    expect(err.classList.contains('mp-banner-err')).toBe(true);
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('Boom');
    expect(document.activeElement).toBe(byAction(target, 'delete'));
    byAction(target, 'dismiss-delete-error')!.click();
    flushSync();
    expect(target.querySelector('[data-role="delete-error-banner"]')).toBeNull();
  });

  it('each deadline label ("soft", "hard", "resub") is its own semi-bold span, apart from the date (Safari pass)', async () => {
    const { target } = mountMpTab({ miniProjects: [mkMp({
      soft_deadline: '2026-09-14T11:47:00Z', hard_deadline: '2026-09-21T11:47:00Z', resubmission_deadline: '2026-09-28T11:47:00Z',
    })] });
    await settle();
    const kinds = Array.from(target.querySelectorAll('td.mp-dl .dl .dl-kind')).map((e) => e.textContent);
    expect(kinds).toEqual(['soft', 'hard', 'resub']);
  });
});

describe('RunMiniProjectsTab — 6b editor hand-off', () => {
  const draft = mkMp({ id: 10, block_id: 1, assignment_md: 'doc body' });

  it('"used by → Edit" on a locked mini-project opens nothing, toasts its reason, and is consumed', async () => {
    clearToasts();
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab({
      miniProjects: [{ ...draft, first_submitted_at: '2026-06-01T00:00:00Z' }],
      pendingEditTarget: draft,
      onPendingEditConsumed,
    });
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    // The target stays set (the spy never clears it): still one toast, one call.
    expect(toasts.list.map((t) => [t.message, t.kind])).toEqual([['Has submissions — editing is off', 'info']]);
    expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('"used by → Edit" with a disabled version opens nothing and toasts the version reason', async () => {
    clearToasts();
    const onPendingEditConsumed = vi.fn();
    const { target, cmp } = mountMpTab({
      miniProjects: [draft],
      versionIsDisabled: true,
      pendingEditTarget: draft,
      onPendingEditConsumed,
    });
    await settle();
    expect(target.querySelector('[role="dialog"]')).toBeNull();
    expect(toasts.list.map((t) => t.message)).toContain("This run's course version is disabled.");
    expect(onPendingEditConsumed).toHaveBeenCalledTimes(1);
    unmount(cmp);
  });

  it('"used by → Edit" opens the tab\'s own row, numbered by position (P17, R21)', async () => {
    fetchSpy.mockImplementation(() => jres([]));
    const { cmp } = mountMpTab({
      miniProjects: [draft],
      pendingEditTarget: { ...draft, assignment_md: 'stale copy' },
      onPendingEditConsumed: vi.fn(),
    });
    await settle();
    expect((document.querySelector('section.modal-panel textarea') as HTMLTextAreaElement).value).toBe('doc body');
    expect(document.getElementById('mp-modal-title')?.textContent).toBe('Edit — Block 1 — Intro');
    unmount(cmp);
  });

  it('after a create that takes the last free block, focus lands on the new row\'s pencil (§Focus › After Create)', async () => {
    const created = mkMp({ id: 2, block_id: 2 });
    fetchSpy.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('/api/runs/10/mini-projects') && init?.method === 'POST' ? jres(created) : jres([]));
    const props = $state({
      runId: 10, runIsPublished: true, runGroupsEnabled: true, runEndDate: '2026-06-30',
      versionIsDisabled: false, pinnedAvailable: true, blocks,
      miniProjects: [mkMp({ id: 1, block_id: 1 })] as MiniProjectResponse[],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
      course: baseCourse,
    });
    props.onRefetchMiniProjects = vi.fn(async () => {
      props.miniProjects = [...props.miniProjects, created];
    });
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props });
    await settle();
    byAction(target, 'new-mp')!.click();
    await settle();
    const ta = document.querySelector('section.modal-panel textarea') as HTMLTextAreaElement;
    ta.value = 'New task';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (document.querySelector('section.modal-panel button[data-action="save"]') as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(byAction(target, 'new-mp')!.disabled).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit mini-project for Block 2');
    unmount(cmp);
  });
});
