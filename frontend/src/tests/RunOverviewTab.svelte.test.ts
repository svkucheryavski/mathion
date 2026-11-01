import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import RunOverviewTab, {
  type DeleteOutcome, type PublishOutcome, type Readiness, type UnpublishOutcome,
} from '../components/runs/RunOverviewTab.svelte';
import type { RunResponse, Version } from '../lib/types';

vi.mock('../stores/toasts.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/toasts.svelte')>();
  return { ...actual, pushToast: vi.fn() };
});

import { pushToast } from '../stores/toasts.svelte';

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  vi.mocked(pushToast).mockClear();
  document.body.innerHTML = '';
});

const makeRun = (over: Partial<RunResponse> = {}): RunResponse => ({
  id: 10, course_id: 1, version_id: 99, title: 'Spring', start_date: '2026-06-01', end_date: '2026-06-30',
  is_published: false, groups_enabled: false, ...over,
} as RunResponse);

const makeVersion = (over: Partial<Version> = {}): Version => ({
  id: 99, course_id: 1, state: 'published', is_disabled: false, info_md: '', info_html: '',
  max_quiz_attempts: 3, label: 'Spring 2026', created_at: '2026-01-01', published_at: '2026-01-02',
  archived_at: null, ...over,
});

function okRes(body: unknown, status = 200): Response {
  return {
    ok: status < 400, status,
    json: () => Promise.resolve(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  } as unknown as Response;
}
const jres = (body: unknown, status = 200) => Promise.resolve(okRes(body, status));

// A response the test releases by hand: a request "in flight".
function held() {
  let release!: (r: Response) => void;
  const p = new Promise<Response>((r) => { release = r; });
  return { p, release };
}

async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  flushSync();
}

type Extra = {
  run?: Partial<RunResponse>;
  pinned?: Version | undefined;
  isAdmin?: boolean;
  readiness?: Readiness;
  publishing?: boolean;
};

function mountOverview(extra: Extra = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const setRunSpy = vi.fn();
  const props = $state({
    run: makeRun(extra.run ?? {}),
    setRun: setRunSpy as (r: RunResponse) => void,
    pinned: 'pinned' in extra ? extra.pinned : makeVersion(),
    isAdmin: extra.isAdmin ?? true,
    readiness: extra.readiness ?? { checks: [] },
    publishing: extra.publishing ?? false,
    onNavigateTab: vi.fn(),
    onPublish: vi.fn(async (): Promise<PublishOutcome> => 'failed'),
    onUnpublish: vi.fn(async (): Promise<UnpublishOutcome> => 'failed'),
    onDeleteRun: vi.fn(async (): Promise<DeleteOutcome> => ({ kind: 'failed', message: 'x' })),
  });
  setRunSpy.mockImplementation((r: RunResponse) => { props.run = r; });
  const cmp = mount(RunOverviewTab, { target, props });
  flushSync();
  return { target, cmp, props, setRunSpy };
}

type Pencil = 'title' | 'start-date' | 'end-date' | 'version';
const edit = (t: HTMLElement, f: Pencil) => t.querySelector(`button[data-action="edit-${f}"]`) as HTMLButtonElement;
const field = (t: HTMLElement) => t.querySelector('input.in-input') as HTMLInputElement | null;
const sw = (t: HTMLElement) => t.querySelector('button[role="switch"]') as HTMLButtonElement;
const rowText = (t: HTMLElement, f: string) =>
  (t.querySelector(`.ov-row[data-field="${f}"] .ov-value`)?.textContent ?? '').trim();

function type(input: HTMLInputElement, v: string) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function key(el: HTMLElement, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  flushSync();
}

describe('Run details (10a, R31, R32)', () => {
  it('shows Title, Start, End and Version; dates read "01 Jun 2026" (Review Focus 5)', () => {
    const { target, cmp } = mountOverview();
    expect(Array.from(target.querySelectorAll('.ov-row .ov-label')).map((l) => l.textContent?.trim()))
      .toEqual(['Title', 'Start', 'End', 'Version']);
    expect(rowText(target, 'title')).toBe('Spring');
    expect(rowText(target, 'start_date')).toBe('01 Jun 2026');
    expect(rowText(target, 'end_date')).toBe('30 Jun 2026');
    expect(rowText(target, 'version')).toBe('Spring 2026 · v. 99');
    expect(target.querySelector('.ov-row[data-field="version"] .ov-ver')?.textContent).toBe('v. 99');
    unmount(cmp);
  });

  it('a version with no label, or a missing version, reads "v. 99"; its pencil is disabled with its reason', () => {
    for (const pinned of [makeVersion({ label: '' }), undefined]) {
      const { target, cmp } = mountOverview({ pinned });
      expect(rowText(target, 'version')).toBe('v. 99');
      expect(edit(target, 'version').disabled).toBe(true);
      expect(edit(target, 'version').title).toBe('The version is fixed when the run is created');
      unmount(cmp);
    }
  });

  it('each pencil is named for its field', () => {
    const { target, cmp } = mountOverview();
    expect(edit(target, 'title').getAttribute('aria-label')).toBe('Edit the title');
    expect(edit(target, 'start-date').title).toBe('Edit the start date');
    expect(edit(target, 'end-date').title).toBe('Edit the end date');
    unmount(cmp);
  });

  it('the pencil opens the field with focus; Enter sends one PATCH {title}, closes it, focus back on the pencil', async () => {
    fetchSpy.mockImplementation(() => jres(makeRun({ title: 'Summer' })));
    const { target, cmp, setRunSpy } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    const input = field(target)!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('Title');
    expect(input.maxLength).toBe(200);
    type(input, 'Summer');
    key(input, 'Enter');
    key(input, 'Enter');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/runs/10');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Summer' });
    expect(setRunSpy).toHaveBeenCalledTimes(1);
    expect(field(target)).toBeNull();
    expect(rowText(target, 'title')).toBe('Summer');
    expect(document.activeElement).toBe(edit(target, 'title'));
    unmount(cmp);
  });

  it('Esc closes without a request, and so does an unchanged value; focus back on the pencil', async () => {
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    key(field(target)!, 'Escape');
    await settle();
    expect(field(target)).toBeNull();
    expect(document.activeElement).toBe(edit(target, 'title'));
    edit(target, 'title').click();
    flushSync();
    key(field(target)!, 'Enter');
    await settle();
    expect(field(target)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(edit(target, 'title'));
    unmount(cmp);
  });

  it('a failed save keeps the field open with the server text under it, and no toast', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'end_date must be on or after start_date' }, 422));
    const { target, cmp } = mountOverview();
    edit(target, 'end-date').click();
    flushSync();
    const input = field(target)!;
    type(input, '2026-05-01');
    key(input, 'Enter');
    await settle();
    expect(field(target)).toBe(input);
    expect(target.querySelector('p.in-err')?.textContent).toBe('end_date must be on or after start_date');
    expect(pushToast).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    unmount(cmp);
  });

  it('a 422 field list shows "Please correct the highlighted fields." and the field stays open (Review Focus 2)', async () => {
    fetchSpy.mockImplementation(() =>
      jres({ detail: [{ loc: ['body', 'title'], msg: 'String too long', type: 'value_error' }] }, 422));
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    expect(field(target)).not.toBeNull();
    expect(target.querySelector('p.in-err')?.textContent).toBe('Please correct the highlighted fields.');
    expect(pushToast).not.toHaveBeenCalled();
    unmount(cmp);
  });

  it('Start and End are date fields; an empty date keeps ✓ disabled with "Choose a date"', () => {
    const { target, cmp } = mountOverview();
    edit(target, 'start-date').click();
    flushSync();
    const input = field(target)!;
    expect(input.type).toBe('date');
    expect(input.getAttribute('aria-label')).toBe('Start date');
    const check = target.querySelector('button[data-glyph="check"]') as HTMLButtonElement;
    expect(check.title).toBe('Save start date');
    type(input, '');
    expect(check.disabled).toBe(true);
    expect(check.title).toBe('Choose a date');
    unmount(cmp);
  });

  it('while one field is open the other pencils are disabled with "Finish editing the title first"', () => {
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    for (const f of ['start-date', 'end-date'] as const) {
      expect(edit(target, f).disabled).toBe(true);
      expect(edit(target, f).title).toBe('Finish editing the title first');
    }
    unmount(cmp);
  });

  it('R32: a field save freezes the switch; the switch request disables the pencils', async () => {
    const save = held();
    fetchSpy.mockImplementationOnce(() => save.p);
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    expect(sw(target).getAttribute('aria-disabled')).toBe('true');
    sw(target).click();
    flushSync();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    const toggle = held();
    fetchSpy.mockImplementationOnce(() => toggle.p);
    sw(target).click();
    await settle();
    for (const f of ['title', 'start-date', 'end-date'] as const) {
      expect(edit(target, f).disabled).toBe(true);
      expect(edit(target, f).title).toBe('Wait for the current change to save');
    }
    toggle.release(okRes(makeRun({ title: 'Summer', groups_enabled: true })));
    await settle();
    expect(edit(target, 'title').disabled).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    unmount(cmp);
  });

  it('R32: Enter in an open field while the switch request runs sends nothing and says why; it saves once the switch settles', async () => {
    const { target, cmp } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    const toggle = held();
    fetchSpy.mockImplementationOnce(() => toggle.p);
    sw(target).click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    field(target)!.focus();
    key(field(target)!, 'Enter');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(target.querySelector('p.in-err')?.textContent).toBe('Wait for the current change to save');
    expect(document.activeElement).toBe(field(target));
    toggle.release(okRes(makeRun({ groups_enabled: true })));
    await settle();
    fetchSpy.mockImplementationOnce(() => jres(makeRun({ title: 'Summer', groups_enabled: true })));
    key(field(target)!, 'Enter');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body as string)).toEqual({ title: 'Summer' });
    expect(rowText(target, 'title')).toBe('Summer');
    unmount(cmp);
  });

  it('leaving mid-save and coming back: nothing is locked and the saved title shows (Review Focus 1)', async () => {
    const save = held();
    fetchSpy.mockImplementationOnce(() => save.p);
    const { target, cmp, props } = mountOverview();
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    unmount(cmp);
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    expect(props.run.title).toBe('Summer');
    const again = mount(RunOverviewTab, { target, props });
    flushSync();
    expect(rowText(target, 'title')).toBe('Summer');
    expect(edit(target, 'title').disabled).toBe(false);
    expect(sw(target).getAttribute('aria-disabled')).toBeNull();
    unmount(again);
  });
});

describe('layout (10a, user 2026-10-13)', () => {
  it('left column: Run details then Settings; right column: Publish readiness then Delete this run', () => {
    const { target, cmp } = mountOverview();
    const cols = [...target.querySelectorAll('.ov-grid > .ov-col')];
    expect(cols).toHaveLength(2);
    const titles = (col: Element) => [...col.querySelectorAll('h2')].map((h) => h.textContent?.trim());
    expect(titles(cols[0])).toEqual(['Run details', 'Settings']);
    expect(titles(cols[1])).toEqual(['Publish readiness', 'Delete this run']);
    unmount(cmp);
  });
});

describe('Settings (R42)', () => {
  it('one PATCH {groups_enabled: true} per toggle; setRun gets the answer', async () => {
    fetchSpy.mockImplementation(() => jres(makeRun({ groups_enabled: true })));
    const { target, cmp, setRunSpy } = mountOverview();
    sw(target).click();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ groups_enabled: true });
    expect(setRunSpy).toHaveBeenCalledTimes(1);
    expect(sw(target).getAttribute('aria-checked')).toBe('true');
    unmount(cmp);
  });

  it('a failure sets the switch back and toasts "Could not update setting: …"', async () => {
    fetchSpy.mockImplementation(() => jres({ detail: 'Cannot disable groups; mini-projects exist' }, 409));
    const { target, cmp } = mountOverview({ run: { groups_enabled: true } });
    sw(target).click();
    flushSync();
    expect(sw(target).getAttribute('aria-checked')).toBe('false');
    await settle();
    expect(sw(target).getAttribute('aria-checked')).toBe('true');
    expect(pushToast).toHaveBeenCalledWith('Could not update setting: Cannot disable groups; mini-projects exist', 'error');
    unmount(cmp);
  });

  it('a rejected TypeError sets the switch back and shows a toast (Polish 3)', async () => {
    fetchSpy.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { target, cmp } = mountOverview({ run: { groups_enabled: true } });
    sw(target).click();
    await settle();
    expect(sw(target).getAttribute('aria-checked')).toBe('true');
    expect(pushToast).toHaveBeenCalledWith('Could not reach server. Check your connection.', 'error');
    unmount(cmp);
  });

  it('a draft: the visible label names the switch and the help line describes it; no lock line', () => {
    const { target, cmp } = mountOverview();
    const s = sw(target);
    expect(target.querySelector(`label[for="${s.id}"]`)?.textContent?.trim()).toBe('Groups enabled');
    expect(s.disabled).toBe(false);
    expect(s.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent))
      .toEqual(['Disabling hides assignments but does not delete them.']);
    unmount(cmp);
  });

  for (const [isAdmin, text] of [
    [true, 'Locked while the run is published — unpublish to change.'],
    [false, 'Locked while the run is published — ask a course admin to unpublish.'],
  ] as const) {
    it(`published (${isAdmin ? 'admin' : 'teacher'}): disabled, the visible lock line first in its description, the same title`, () => {
      const { target, cmp } = mountOverview({ isAdmin, run: { is_published: true } });
      const s = sw(target);
      expect(s.disabled).toBe(true);
      expect(s.title).toBe(text);
      expect(s.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent))
        .toEqual([text, 'Disabling hides assignments but does not delete them.']);
      unmount(cmp);
    });
  }
});

describe('role gating', () => {
  it('teachers edit the fields and the switch too', () => {
    const { target, cmp } = mountOverview({ isAdmin: false });
    for (const f of ['title', 'start-date', 'end-date'] as const) expect(edit(target, f).disabled).toBe(false);
    expect(sw(target).disabled).toBe(false);
    unmount(cmp);
  });

  it('hides Delete-run from teachers', () => {
    const { target, cmp } = mountOverview({ isAdmin: false });
    expect(target.querySelector('button[data-action="delete-run"]')).toBeNull();
    unmount(cmp);
  });

  it('shows Delete-run to admins on a draft', () => {
    const { target, cmp } = mountOverview({ isAdmin: true });
    expect(target.querySelector('button[data-action="delete-run"]')).not.toBeNull();
    unmount(cmp);
  });
});

describe('R32 across the run writes', () => {
  const WAIT = 'Wait for the current change to save';

  async function startTitleSave(target: HTMLElement) {
    const save = held();
    fetchSpy.mockImplementationOnce(() => save.p);
    edit(target, 'title').click();
    flushSync();
    type(field(target)!, 'Summer');
    key(field(target)!, 'Enter');
    await settle();
    return save;
  }

  it('during a field save, Publish run and the trash are aria-disabled with the reason and do nothing', async () => {
    const { target, cmp, props } = mountOverview();
    const save = await startTitleSave(target);
    const pub = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(pub.disabled).toBe(false);
    expect(pub.getAttribute('aria-disabled')).toBe('true');
    expect(pub.title).toBe(WAIT);
    pub.click();
    flushSync();
    expect(props.onPublish).not.toHaveBeenCalled();
    const trash = target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement;
    expect(trash.getAttribute('aria-disabled')).toBe('true');
    expect(trash.title).toBe(WAIT);
    trash.click();
    flushSync();
    expect(target.querySelector('.danger-confirm')).toBeNull();
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    expect(pub.getAttribute('aria-disabled')).toBeNull();
    unmount(cmp);
  });

  it('during a field save on a published run, Unpublish does nothing', async () => {
    const { target, cmp } = mountOverview({ run: { is_published: true } });
    const save = await startTitleSave(target);
    const unpub = target.querySelector('button[data-action="unpublish"]') as HTMLButtonElement;
    expect(unpub.getAttribute('aria-disabled')).toBe('true');
    unpub.click();
    flushSync();
    expect(target.querySelector('button[data-action="confirm-unpublish"]')).toBeNull();
    save.release(okRes(makeRun({ title: 'Summer', is_published: true })));
    await settle();
    unmount(cmp);
  });

  it('while the page publishes (also after a remount), the pencils and the switch do nothing; Publish run is busy', () => {
    const { target, cmp } = mountOverview({ publishing: true });
    expect(edit(target, 'title').disabled).toBe(true);
    expect(edit(target, 'title').title).toBe(WAIT);
    expect(sw(target).getAttribute('aria-disabled')).toBe('true');
    const pub = target.querySelector('button[data-action="publish"]') as HTMLButtonElement;
    expect(pub.getAttribute('aria-busy')).toBe('true');
    expect(pub.textContent?.trim()).toBe('Publishing…');
    unmount(cmp);
  });

  it("an open danger panel's Force delete is disabled while a field saves", async () => {
    const { target, cmp } = mountOverview();
    (target.querySelector('button[data-action="delete-run"]') as HTMLButtonElement).click();
    flushSync();
    const save = await startTitleSave(target);
    const force = target.querySelector('button[data-action="force-delete"]') as HTMLButtonElement;
    expect(force.disabled).toBe(true);
    expect(force.title).toBe(WAIT);
    save.release(okRes(makeRun({ title: 'Summer' })));
    await settle();
    expect(force.disabled).toBe(false);
    unmount(cmp);
  });
});
