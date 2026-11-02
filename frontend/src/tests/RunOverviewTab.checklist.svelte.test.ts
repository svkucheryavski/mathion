import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab, {
  type DeleteOutcome, type PublishOutcome, type Readiness, type ReadinessRow, type UnpublishOutcome,
} from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse } from '../lib/types';

beforeEach(() => {
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

const TEACHER: ReadinessRow = { id: 'teacher', label: 'At least one teacher assigned', state: 'ok' };
const VERSION: ReadinessRow = { id: 'version', label: 'Course version enabled', state: 'ok' };
const ASSIGNED_NA: ReadinessRow = { id: 'assigned', label: 'Every student assigned to a group', state: 'na' };
const SIZES_NA: ReadinessRow = { id: 'sizes', label: 'No group over 10 students', state: 'na' };
const NO_TEACHER: ReadinessRow = {
  id: 'teacher', label: 'At least one teacher assigned', state: 'violated',
  hint: 'Add a teacher — open Teachers', hintTab: 'teachers', reason: 'No teacher is assigned yet',
};
const UNASSIGNED: ReadinessRow = {
  id: 'assigned', label: 'Every student assigned to a group', state: 'violated',
  hint: '3 unassigned — open Roster', hintTab: 'roster', reason: '3 students are still unassigned to a group',
};
const NO_GROUPS: ReadinessRow = {
  id: 'assigned', label: 'Every student assigned to a group', state: 'violated',
  hint: 'No groups yet — open Groups', hintTab: 'groups', reason: '1 student is still unassigned to a group',
};
const READY: Readiness = { checks: [TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] };

type Extra = { run?: Partial<RunResponse>; readiness?: Readiness; isAdmin?: boolean };

function mountTab(extra: Extra = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props = $state({
    run: makeRun(extra.run ?? {}),
    setRun: vi.fn() as (r: RunResponse) => void,
    pinned: undefined,
    isAdmin: extra.isAdmin ?? true,
    readiness: extra.readiness ?? READY,
    publishing: false,
    onNavigateTab: vi.fn(),
    onPublish: vi.fn(async (): Promise<PublishOutcome> => 'failed'),
    onUnpublish: vi.fn(async (): Promise<UnpublishOutcome> => 'failed'),
    onDeleteRun: vi.fn(async (): Promise<DeleteOutcome> => ({ kind: 'failed', message: 'x' })),
  });
  const cmp = mount(RunOverviewTab, { target, props });
  flushSync();
  return { target, cmp, props };
}

const btn = (t: HTMLElement, action: string) => t.querySelector(`button[data-action="${action}"]`) as HTMLButtonElement | null;
const note = (t: HTMLElement) => t.querySelector('.ov-foot-note')?.textContent?.trim();

describe('Publish readiness rows (R34)', () => {
  it('the rows in order, each with its status box, hidden state word and hint', () => {
    const { target, cmp } = mountTab({ run: { groups_enabled: true }, readiness: { checks: [TEACHER, VERSION, UNASSIGNED, SIZES_NA] } });
    const lis = Array.from(target.querySelectorAll('li.ov-check'));
    expect(lis.map((li) => li.getAttribute('data-check'))).toEqual(['teacher', 'version', 'assigned', 'sizes']);
    expect(lis.map((li) => li.querySelector('.ov-box')!.className.match(/ov-box-(\w+)/)![1])).toEqual(['ok', 'ok', 'violated', 'na']);
    expect(lis.every((li) => li.querySelector('.ov-box')!.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(lis.map((li) => li.querySelector('.ov-vh')?.textContent ?? null)).toEqual(['Done:', 'Done:', 'To do:', null]);
    expect(lis.map((li) => li.querySelector('.ov-check-label')!.textContent)).toEqual([
      'At least one teacher assigned', 'Course version enabled', 'Every student assigned to a group', 'No group over 10 students',
    ]);
    expect(lis[2].querySelector('button[data-action="goto-unassigned"]')!.textContent).toBe('3 unassigned — open Roster');
    expect(lis[3].querySelector('.ov-hint')!.textContent).toBe('not applicable');
    unmount(cmp);
  });

  it('the hint links open their tab: Roster with the Unassigned filter, Teachers, Groups (P10, P20)', () => {
    const one = mountTab({ readiness: { checks: [NO_TEACHER, VERSION, UNASSIGNED, SIZES_NA] } });
    btn(one.target, 'goto-unassigned')!.click();
    expect(one.props.onNavigateTab).toHaveBeenLastCalledWith('roster', 'unassigned');
    btn(one.target, 'goto-teachers')!.click();
    expect(one.props.onNavigateTab).toHaveBeenLastCalledWith('teachers', null);
    unmount(one.cmp);
    const two = mountTab({ readiness: { checks: [TEACHER, VERSION, NO_GROUPS, SIZES_NA] } });
    btn(two.target, 'goto-groups')!.click();
    expect(two.props.onNavigateTab).toHaveBeenLastCalledWith('groups', null);
    unmount(two.cmp);
  });

  it('the card heading is a focus fallback (tabindex -1)', () => {
    const { target, cmp } = mountTab();
    const h = Array.from(target.querySelectorAll('h2')).find((e) => e.textContent === 'Publish readiness')!;
    expect(h.getAttribute('tabindex')).toBe('-1');
    unmount(cmp);
  });
});

describe('The readiness footer', () => {
  it('admin, draft, nothing to fix: "Ready to publish." and Publish run enabled', () => {
    const { target, cmp } = mountTab();
    expect(note(target)).toBe('Ready to publish.');
    const pub = btn(target, 'publish')!;
    expect(pub.textContent?.trim()).toBe('Publish run');
    expect(pub.disabled).toBe(false);
    unmount(cmp);
  });

  it('one violated row: "Fix the outstanding check to publish."; Publish run disabled with its reason', () => {
    const { target, cmp } = mountTab({ readiness: { checks: [NO_TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] } });
    expect(note(target)).toBe('Fix the outstanding check to publish.');
    expect(btn(target, 'publish')!.disabled).toBe(true);
    expect(btn(target, 'publish')!.title).toBe('No teacher is assigned yet');
    unmount(cmp);
  });

  it('two violated rows: "Fix the 2 outstanding checks to publish."; the title is the first one\'s reason', () => {
    const { target, cmp } = mountTab({ readiness: { checks: [TEACHER, VERSION, UNASSIGNED, { ...SIZES_NA, state: 'violated', hint: 'Group A (12)', reason: 'Groups over 10 students: Group A (12)' }] } });
    expect(note(target)).toBe('Fix the 2 outstanding checks to publish.');
    expect(btn(target, 'publish')!.title).toBe('3 students are still unassigned to a group');
    unmount(cmp);
  });

  it('teacher: the rows and "A course admin publishes this run." with no button, and no delete card', () => {
    const { target, cmp } = mountTab({ isAdmin: false });
    expect(target.querySelectorAll('li.ov-check')).toHaveLength(4);
    expect(note(target)).toBe('A course admin publishes this run.');
    expect(btn(target, 'publish')).toBeNull();
    expect(btn(target, 'delete-run')).toBeNull();
    unmount(cmp);
  });

  it('teacher, published: "Published — students have access." and no button', () => {
    const { target, cmp } = mountTab({ isAdmin: false, run: { is_published: true } });
    expect(note(target)).toBe('Published — students have access.');
    expect(btn(target, 'unpublish')).toBeNull();
    unmount(cmp);
  });

  it('admin, published: "Published — students have access." with Unpublish', () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    expect(note(target)).toBe('Published — students have access.');
    expect(btn(target, 'unpublish')!.textContent?.trim()).toBe('Unpublish');
    unmount(cmp);
  });
});

describe('Publish and Unpublish focus (R33, spec §Focus)', () => {
  it('"published" moves focus to Unpublish', async () => {
    const { target, cmp, props } = mountTab();
    props.onPublish = vi.fn(async (): Promise<PublishOutcome> => {
      props.run = makeRun({ is_published: true });
      return 'published';
    });
    const pub = btn(target, 'publish')!;
    pub.focus();
    pub.click();
    await settle();
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });

  it('"failed" keeps focus on Publish run', async () => {
    const { target, cmp, props } = mountTab();
    const pub = btn(target, 'publish')!;
    pub.focus();
    pub.click();
    await settle();
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(pub);
    unmount(cmp);
  });

  // F7: the failure's refetch reveals a violation, which natively disables the
  // focused Publish run. jsdom keeps focus on a button that turns disabled, so
  // a stand-in drops it the way a browser does.
  it('a failed Publish that reveals a violation leaves focus on Publish, else the readiness heading', async () => {
    const { target, cmp, props } = mountTab();
    props.onPublish = vi.fn(async (): Promise<PublishOutcome> => {
      props.readiness = { checks: [NO_TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] };
      flushSync();
      const stand = document.createElement('button');
      target.append(stand);
      stand.focus();
      stand.remove();
      return 'failed';
    });
    const pub = btn(target, 'publish')!;
    pub.focus();
    pub.click();
    await settle();
    expect(pub.disabled).toBe(true);
    expect(document.activeElement).toBe(target.querySelector('h2.ov-title[tabindex="-1"]'));
    expect(document.activeElement!.textContent).toBe('Publish readiness');
    unmount(cmp);
  });

  it('Unpublish opens the one-line confirm with focus on its Cancel; Cancel returns focus to Unpublish', async () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    btn(target, 'unpublish')!.click();
    flushSync();
    const confirm = target.querySelector('.inline-confirm') as HTMLElement;
    expect(confirm.textContent).toContain('Students lose access immediately; their progress is kept.');
    expect(btn(target, 'confirm-unpublish')!.textContent).toBe('Unpublish');
    const cancel = confirm.querySelector('button.cancel') as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    await settle();
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });

  it('"unpublished" moves focus to Publish run, or to the readiness heading while Publish run is disabled', async () => {
    for (const readiness of [READY, { checks: [NO_TEACHER, VERSION, ASSIGNED_NA, SIZES_NA] }]) {
      const { target, cmp, props } = mountTab({ run: { is_published: true }, readiness });
      props.onUnpublish = vi.fn(async (): Promise<UnpublishOutcome> => {
        props.run = makeRun({ is_published: false });
        return 'unpublished';
      });
      btn(target, 'unpublish')!.click();
      flushSync();
      btn(target, 'confirm-unpublish')!.click();
      await settle();
      const expected = readiness === READY
        ? btn(target, 'publish')
        : Array.from(target.querySelectorAll('h2')).find((e) => e.textContent === 'Publish readiness');
      expect(document.activeElement).toBe(expected);
      unmount(cmp);
    }
  });

  it('"failed" closes the confirm and returns focus to Unpublish', async () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    btn(target, 'unpublish')!.click();
    flushSync();
    btn(target, 'confirm-unpublish')!.click();
    await settle();
    expect(btn(target, 'confirm-unpublish')).toBeNull();
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });
});

describe('Delete this run (D24)', () => {
  const box = (t: HTMLElement) => t.querySelector('input[data-role="danger-ack"]') as HTMLInputElement | null;

  it('the card: heading, the muted line, and the trash named "Delete this run"', () => {
    const { target, cmp } = mountTab();
    const h = Array.from(target.querySelectorAll('h2')).find((e) => e.textContent === 'Delete this run')!;
    expect(h.getAttribute('tabindex')).toBe('-1');
    expect(target.querySelector('.ov-del-sub')?.textContent).toBe('Only while unpublished. Roster, groups and submissions go with it.');
    const trash = btn(target, 'delete-run')!;
    expect(trash.getAttribute('aria-label')).toBe('Delete this run');
    expect(trash.getAttribute('aria-expanded')).toBe('false');
    unmount(cmp);
  });

  it('published: the trash shows, disabled with "Unpublish the run before deleting it"', () => {
    const { target, cmp } = mountTab({ run: { is_published: true } });
    const trash = btn(target, 'delete-run')!;
    expect(trash.disabled).toBe(true);
    expect(trash.title).toBe('Unpublish the run before deleting it');
    unmount(cmp);
  });

  it('draft: the trash opens the danger panel with its message; Force delete is inert until "I understand"', () => {
    const { target, cmp, props } = mountTab();
    btn(target, 'delete-run')!.click();
    flushSync();
    expect(btn(target, 'delete-run')!.getAttribute('aria-expanded')).toBe('true');
    expect(target.querySelector('.danger-confirm .dc-msg')?.textContent).toBe(
      'This deletes the run with its roster, groups, teacher assignments, mini-projects, assets, submissions and evaluations, and every uploaded file. It cannot be undone.');
    expect(document.activeElement).toBe(box(target));
    const force = btn(target, 'force-delete')!;
    expect(force.getAttribute('aria-disabled')).toBe('true');
    force.click();
    expect(props.onDeleteRun).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Cancel closes the panel and returns focus to the trash', async () => {
    const { target, cmp } = mountTab();
    btn(target, 'delete-run')!.click();
    flushSync();
    (Array.from(target.querySelectorAll('.danger-confirm button')).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement).click();
    await settle();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(document.activeElement).toBe(btn(target, 'delete-run'));
    unmount(cmp);
  });

  it('Force delete runs onDeleteRun with the panel busy; "failed" shows its message under the panel and re-arms with focus on the box', async () => {
    const { target, cmp, props } = mountTab();
    let release!: (o: DeleteOutcome) => void;
    props.onDeleteRun = vi.fn(() => new Promise<DeleteOutcome>((r) => { release = r; }));
    btn(target, 'delete-run')!.click();
    flushSync();
    box(target)!.click();
    flushSync();
    const force = btn(target, 'force-delete')!;
    force.focus();
    force.click();
    await settle();
    expect(props.onDeleteRun).toHaveBeenCalledTimes(1);
    expect(force.getAttribute('aria-busy')).toBe('true');
    release({ kind: 'failed', message: 'Database is busy' });
    await settle();
    await settle();
    const err = target.querySelector('.ov-err') as HTMLElement;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toBe('Database is busy');
    expect(box(target)!.checked).toBe(false);
    expect(document.activeElement).toBe(box(target));
    unmount(cmp);
  });

  it('publishing with the panel open closes it and clears its error line (an open panel is not a write)', async () => {
    const { target, cmp, props } = mountTab();
    props.onDeleteRun = vi.fn(async (): Promise<DeleteOutcome> => ({ kind: 'failed', message: 'Database is busy' }));
    props.onPublish = vi.fn(async (): Promise<PublishOutcome> => {
      props.run = makeRun({ is_published: true });
      return 'published';
    });
    btn(target, 'delete-run')!.click();
    flushSync();
    box(target)!.click();
    flushSync();
    btn(target, 'force-delete')!.click();
    await settle();
    await settle();
    expect(target.querySelector('.ov-err')).not.toBeNull();
    btn(target, 'publish')!.click();
    await settle();
    expect(props.onPublish).toHaveBeenCalledTimes(1);
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(target.querySelector('.ov-err')).toBeNull();
    expect(btn(target, 'delete-run')!.getAttribute('aria-expanded')).toBe('false');
    expect(btn(target, 'delete-run')!.hasAttribute('aria-controls')).toBe(false);
    expect(document.activeElement).toBe(btn(target, 'unpublish'));
    unmount(cmp);
  });

  it('the run turning published from outside (a refetch) hides the open panel, and it stays closed after an unpublish', () => {
    const { target, cmp, props } = mountTab();
    btn(target, 'delete-run')!.click();
    flushSync();
    expect(target.querySelector('.danger-confirm')).not.toBeNull();
    props.run = makeRun({ is_published: true });
    flushSync();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(btn(target, 'delete-run')!.getAttribute('aria-expanded')).toBe('false');
    props.run = makeRun({ is_published: false });
    flushSync();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(btn(target, 'delete-run')!.getAttribute('aria-expanded')).toBe('false');
    unmount(cmp);
  });

  it('"published-now" closes the panel and focuses the card heading (the trash is disabled by then)', async () => {
    const { target, cmp, props } = mountTab();
    props.onDeleteRun = vi.fn(async (): Promise<DeleteOutcome> => {
      props.run = makeRun({ is_published: true });
      return { kind: 'published-now' };
    });
    btn(target, 'delete-run')!.click();
    flushSync();
    box(target)!.click();
    flushSync();
    btn(target, 'force-delete')!.click();
    await settle();
    await settle();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    expect(btn(target, 'delete-run')!.disabled).toBe(true);
    expect((document.activeElement as HTMLElement).textContent).toBe('Delete this run');
    unmount(cmp);
  });
});
