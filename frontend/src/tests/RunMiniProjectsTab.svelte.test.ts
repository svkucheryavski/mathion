import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunMiniProjectsTab from '../components/runs/RunMiniProjectsTab.svelte';
import type { MiniProjectResponse, BlockResponse } from '../lib/types';

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

describe('RunMiniProjectsTab', () => {
  it('empty state CTA with explainer + create hint when no MPs', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
    await settle();
    expect(target.textContent).toContain('No mini-projects yet');
    expect(target.textContent).toContain('Click + New mini-project');
  });

  it('actionable banner when !runGroupsEnabled; link → onNavigateToTab("overview")', async () => {
    const onNav = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: false,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: onNav,
    } });
    await settle();
    expect(target.textContent).toContain('Mini-projects require groups');
    const link = target.querySelector('button[data-action="nav-overview"]') as HTMLElement;
    link.click();
    expect(onNav).toHaveBeenCalledWith('overview');
  });

  it('actionable banner when versionIsDisabled; [+ New] disabled with tooltip (spec lines 548, 595)', async () => {
    const onNav = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: true, pinnedAvailable: true,
      blocks, miniProjects: [],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: onNav,
    } });
    await settle();
    expect(target.textContent).toContain("This run's course version is disabled");
    const link = target.querySelector('button[data-action="nav-overview"]') as HTMLElement;
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
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: false, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [draftMp],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: onNav,
    } });
    await settle();
    expect(target.textContent).toContain('Run is not yet published');
    const link = target.querySelector('button[data-action="nav-overview"]') as HTMLElement;
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
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: false,
      blocks: [], miniProjects: [],
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
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
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: mps,
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
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
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: mps,
      onRefetchMiniProjects: vi.fn(),
      onNavigateToTab: vi.fn(),
    } });
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
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks, miniProjects: [mp],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
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
    const target = document.createElement('div');
    document.body.appendChild(target);
    const cmp = mount(RunMiniProjectsTab, { target, props: {
      runId: 10, runIsPublished: true, runGroupsEnabled: true,
      runEndDate: '2026-06-30', versionIsDisabled: false, pinnedAvailable: true,
      blocks: localBlocks, miniProjects: [lockedMp],
      onRefetchMiniProjects: vi.fn().mockResolvedValue(undefined),
      onNavigateToTab: vi.fn(),
    } });
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
});
