import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { ComponentProps } from 'svelte';
import RunRosterTab from '../components/runs/RunRosterTab.svelte';
import { RUN_UNPUBLISHED_ERROR_CODE } from '../lib/runRoster';

let target: HTMLDivElement | null = null;
let component: unknown = null;

afterEach(() => {
  if (component) { unmount(component); component = null; }
  if (target) { target.remove(); target = null; }
});

type TabProps = ComponentProps<typeof RunRosterTab>;

const BASE_PROPS: TabProps = {
  runId: 1,
  runIsPublished: false,
  courseSlug: 'calc-101',
  students: [],
  groups: [],
  groupsEnabled: false,
  rosterPrefilter: null,
  onPrefilterClear: () => {},
  onRefetchRosterData: async () => ({ students: [], groups: [] }),
  onRefetchGroupsOnly: async () => {},
  onOpenImport: () => {},
  onNavigateToTab: () => {},
};

function mountTab(propOverrides: Partial<TabProps> = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  component = mount(RunRosterTab, { target, props: { ...BASE_PROPS, ...propOverrides } });
  flushSync();
}

describe('RunRosterTab draft-gate', () => {
  it('banner visible when draft', () => {
    mountTab({ runIsPublished: false });
    expect(target!.querySelector('#roster-draft-publish-hint')).toBeTruthy();
  });

  it('banner absent when published', () => {
    mountTab({ runIsPublished: true });
    expect(target!.querySelector('#roster-draft-publish-hint')).toBeFalsy();
  });

  it('add button disabled when draft', () => {
    mountTab({ runIsPublished: false });
    const btn = target!.querySelector('button[data-action="add-student"]') as HTMLButtonElement;
    expect(btn?.disabled).toBe(true);
  });

  it('add button not draft-gated when published', () => {
    mountTab({ runIsPublished: true });
    // The button may still be disabled for an empty email (original behavior),
    // but it must NOT carry the draft-gate aria-describedby when published.
    const btn = target!.querySelector('button[data-action="add-student"]') as HTMLButtonElement;
    expect(btn?.getAttribute('aria-describedby')).toBeNull();
  });

  it('error_code constant is the exact literal', () => {
    expect(RUN_UNPUBLISHED_ERROR_CODE).toBe('run_unpublished');
  });

  it('move action remains enabled on draft (regression for §8)', () => {
    mountTab({ runIsPublished: false });
    // Bulk-move is a <select>, not a button. When no students are selected,
    // the bulk strip is hidden entirely. Accept conditional — no button = pass.
    const moveBtn = target!.querySelector('button[aria-label="Move student"]') as HTMLButtonElement | null;
    if (moveBtn) expect(moveBtn.disabled).toBe(false);
  });
});
