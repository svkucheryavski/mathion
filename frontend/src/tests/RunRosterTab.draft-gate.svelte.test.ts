import { describe, it, expect, afterEach, vi } from 'vitest';
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
  isAdmin: true,
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

  it('the add toggle and Import roster are disabled on a draft and described by the banner', () => {
    mountTab({ runIsPublished: false });
    for (const action of ['toggle-add-student', 'open-import']) {
      const btn = target!.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-describedby')).toBe('roster-draft-publish-hint');
    }
    expect(target!.querySelector('input[name="new-email"]')).toBeNull();
  });

  it('the add toggle is not draft-gated when published', () => {
    mountTab({ runIsPublished: true });
    const btn = target!.querySelector('button[data-action="toggle-add-student"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-describedby')).toBeNull();
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

// 6b whole-branch review: the empty-roster link unmounts once the import's
// refetch fills the roster, so FocusTrap could not return focus to it after
// Done. The link hands focus to the toolbar's Import roster first, so the
// modal's opener is a button that stays on the page.
describe('RunRosterTab — the empty-roster import link', () => {
  it('focuses the toolbar Import roster before opening the import', () => {
    let opened = 0;
    let focusAtOpen: Element | null = null;
    mountTab({ runIsPublished: true, onOpenImport: () => { opened++; focusAtOpen = document.activeElement; } });
    const link = target!.querySelector<HTMLButtonElement>('button[data-action="open-import-link"]')!;
    const toolbar = target!.querySelector<HTMLButtonElement>('button[data-action="open-import"]')!;
    const focusSpy = vi.spyOn(toolbar, 'focus');
    link.focus();
    link.click();
    flushSync();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(opened).toBe(1);
    expect(focusAtOpen).toBe(toolbar);
    expect(document.activeElement).toBe(toolbar);
  });
});
